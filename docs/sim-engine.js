(function (root) {
  "use strict";

  const CFG = root.SIM_CONFIG;
  const LEG_ORDER = ["CM01_MAK_to_FOR", "CM01_FOR_to_MAK", "CM03_MAK_to_KAD", "CM03_KAD_to_MAK"];
  const CONNECTOR_LEGS = new Set(["CM01_MAK_to_FOR", "CM03_MAK_to_KAD"]);
  const TRANSFER_DIRECTIONS = [
    { group: "A", label: "Group A (KAD->FOR)", feederLeg: "CM03_KAD_to_MAK", connectorLeg: "CM01_MAK_to_FOR" },
    { group: "B", label: "Group B (FOR->KAD)", feederLeg: "CM01_FOR_to_MAK", connectorLeg: "CM03_MAK_to_KAD" }
  ];
  const EPS = 1e-9;

  function createSeededRng(seedInt) {
    let a = seedInt >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseHhmmToMinutes(hhmmStr) {
    const parts = hhmmStr.trim().split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function formatMinutesToHhmm(totalMin) {
    if (!Number.isFinite(totalMin)) return "--:--";
    const rounded = Math.max(0, Math.round(totalMin));
    const hh = String(Math.floor(rounded / 60) % 24).padStart(2, "0");
    const mm = String(rounded % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function isPeakTime(timeMin) {
    return CFG.timeWindow.peakWindowsMin.some(([start, end]) => timeMin >= start && timeMin < end);
  }

  function buildParametricTransitionMatrix(jamParam) {
    const p = Number(jamParam);
    return [
      [1.0 - p, 0.7 * p, 0.3 * p],
      [0.4 * (1.0 - p), 0.4, 0.2 + 0.4 * p],
      [0.1 * (1.0 - p), 0.3 * (1.0 - p), 0.6 + 0.4 * p]
    ];
  }

  function computeStationaryDistribution(matrix) {
    let pi = [1 / 3, 1 / 3, 1 / 3];
    for (let iter = 0; iter < 500; iter++) {
      const next = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) next[j] += pi[i] * matrix[i][j];
      }
      pi = next;
    }
    return pi;
  }

  function expectedSpeedForJamParam(jamParam) {
    const pi = computeStationaryDistribution(buildParametricTransitionMatrix(jamParam));
    const speeds = CFG.trafficModel.stateSpeedsKmph;
    return pi[0] * speeds[0] + pi[1] * speeds[1] + pi[2] * speeds[2];
  }

  function calibrateJamParamBisection(targetSpeedKmph) {
    let [low, high] = CFG.trafficModel.jamParamBounds;
    const vMax = expectedSpeedForJamParam(low);
    const vMin = expectedSpeedForJamParam(high);
    const clampedTarget = Math.max(vMin, Math.min(vMax, targetSpeedKmph));
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (low + high);
      if (expectedSpeedForJamParam(mid) > clampedTarget) low = mid;
      else high = mid;
    }
    return 0.5 * (low + high);
  }

  function sampleDiscreteState(rowProbs, uniformDraw) {
    let cum = 0.0;
    for (let i = 0; i < rowProbs.length; i++) {
      cum += rowProbs[i];
      if (uniformDraw <= cum) return i;
    }
    return rowProbs.length - 1;
  }

  function sampleExponentialInterarrival(ratePerMin, rng) {
    const u = Math.min(rng(), 1.0 - 1e-12);
    return -Math.log(1.0 - u) / ratePerMin;
  }

  function samplePoissonKnuth(meanVal, rng) {
    const limit = Math.exp(-meanVal);
    let k = 0;
    let prod = 1.0;
    while (true) {
      k += 1;
      prod *= rng();
      if (prod <= limit) return k - 1;
    }
  }

  function sampleStandardNormalBoxMuller(rng) {
    const u1 = Math.max(1e-12, 1.0 - rng());
    const u2 = rng();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  function generateDailyTrafficGrid(rng, matrixOffpeak, matrixPeak) {
    const { dayStartMin, dayEndMin, trafficStepMin } = CFG.timeWindow;
    const nSlots = Math.floor((dayEndMin - dayStartMin) / trafficStepMin) + 24;
    const states = new Array(nSlots);
    let state = 0;
    for (let slot = 0; slot < nSlots; slot++) {
      states[slot] = state;
      const tMin = dayStartMin + slot * trafficStepMin;
      const mat = isPeakTime(tMin) ? matrixPeak : matrixOffpeak;
      state = sampleDiscreteState(mat[state], rng());
    }
    return states;
  }

  function getTrafficStateAt(trafficStates, timeMin) {
    const { dayStartMin, trafficStepMin } = CFG.timeWindow;
    const slot = Math.max(0, Math.min(trafficStates.length - 1, Math.floor((timeMin - dayStartMin) / trafficStepMin)));
    return trafficStates[slot];
  }

  function travelSegmentMinutes(startTimeMin, distanceKm, trafficStates, alpha) {
    const { dayStartMin, trafficStepMin } = CFG.timeWindow;
    const speeds = CFG.trafficModel.stateSpeedsKmph;
    let remainingKm = Number(distanceKm);
    let currentTimeMin = Number(startTimeMin);
    while (remainingKm > EPS) {
      let slot = Math.max(0, Math.floor((currentTimeMin - dayStartMin) / trafficStepMin));
      slot = Math.min(slot, trafficStates.length - 1);
      const slotEndMin = dayStartMin + (slot + 1) * trafficStepMin;
      const availMin = Math.max(0.01, slotEndMin - currentTimeMin);
      const speedKmPerMin = (alpha * speeds[trafficStates[slot]]) / 60.0;
      const maxDistKm = speedKmPerMin * availMin;
      if (maxDistKm >= remainingKm) {
        currentTimeMin += remainingKm / speedKmPerMin;
        remainingKm = 0.0;
      } else {
        remainingKm -= maxDistKm;
        currentTimeMin = slotEndMin;
      }
    }
    return currentTimeMin - startTimeMin;
  }

  function borellaRoadFraction(legCfg) {
    // Share of the leg's road distance that lies before Borella.
    const total = legCfg.segmentDistancesKm.reduce((a, b) => a + b, 0);
    const before = legCfg.segmentDistancesKm.slice(0, legCfg.borellaStopIndex).reduce((a, b) => a + b, 0);
    return before / total;
  }

  function buildScheduledLegTrips(legKey, shiftMin) {
    const legCfg = CFG.routes[legKey];
    const frac = borellaRoadFraction(legCfg);
    return CFG.timetables[legKey]
      .map((row) => {
        const originMin = parseHhmmToMinutes(row.departure) + shiftMin;
        return {
          tripId: row.tripId,
          originSchedMin: originMin,
          borellaSchedMin: originMin + frac * legCfg.scheduledRunMin,
          destSchedMin: originMin + legCfg.scheduledRunMin
        };
      })
      .sort((x, y) => x.originSchedMin - y.originSchedMin);
  }

  function generateStopArrivals(legCfg, firstOriginMin, rng) {
    const nStops = legCfg.stops.length;
    const queues = Array.from({ length: nStops }, () => []);
    const { dayStartMin, dayEndMin, preDepartureAccumMin } = CFG.timeWindow;
    const { peakMultiplier, offpeakMultiplier } = CFG.demand;
    const startWindowMin = Math.max(dayStartMin, firstOriginMin - preDepartureAccumMin);
    for (let s = 0; s < nStops - 1; s++) {
      const baseRate = legCfg.baseArrivalRatePaxPerMin[s];
      if (baseRate <= 0) continue;
      const maxRate = baseRate * peakMultiplier;
      let t = startWindowMin;
      while (true) {
        t += sampleExponentialInterarrival(maxRate, rng);
        if (t >= dayEndMin) break;
        const rate = baseRate * (isPeakTime(t) ? peakMultiplier : offpeakMultiplier);
        if (rng() <= rate / maxRate) {
          const nDown = nStops - 1 - s;
          const destIdx = s + 1 + Math.min(Math.floor(rng() * nDown), nDown - 1);
          queues[s].push({ arrMin: t, destIdx });
        }
      }
    }
    return queues;
  }

  function simulateLegDay(legKey, schedTrips, trafficStates, queues, alpha, capacityPax, patienceMin, deferredStopIdx) {
    const legCfg = CFG.routes[legKey];
    const cursors = new Array(legCfg.stops.length).fill(0);
    const { doorTimeSec, alightTimeSec, boardTimeSec } = CFG.busParameters;
    const borellaIdx = legCfg.borellaStopIndex;

    return schedTrips.map((trip, tripIdx) => {
      const nextHeadwayMin = tripIdx + 1 < schedTrips.length ? schedTrips[tripIdx + 1].originSchedMin - trip.originSchedMin : Infinity;
      let tCurr = trip.originSchedMin;
      let onboardDests = [];
      let leftBehindTotal = 0;
      const stopTimeline = [];
      let borellaArrMin = tCurr;
      let borellaDwellMin = 0;
      let borellaOnboardPax = 0;

      for (let s = 0; s < legCfg.stops.length; s++) {
        if (s > 0) tCurr += travelSegmentMinutes(tCurr, legCfg.segmentDistancesKm[s - 1], trafficStates, alpha);
        const arrAtStop = tCurr;
        const remaining = [];
        let alighting = 0;
        for (const d of onboardDests) {
          if (d === s) alighting++;
          else remaining.push(d);
        }
        onboardDests = remaining;

        const q = queues[s];
        const c = cursors[s];
        let waiting = 0;
        if (s !== deferredStopIdx) {
          while (c + waiting < q.length && q[c + waiting].arrMin <= tCurr) waiting++;
        }
        const freeSeats = capacityPax === null ? waiting : Math.max(0, capacityPax - onboardDests.length);
        const boarding = Math.min(waiting, freeSeats);
        const leftHere = waiting - boarding;
        leftBehindTotal += leftHere;
        for (let k = 0; k < boarding; k++) onboardDests.push(q[c + k].destIdx);
        cursors[s] = c + boarding;
        if (leftHere > 0 && nextHeadwayMin > patienceMin) cursors[s] += leftHere;

        const dwellMin = (doorTimeSec + alightTimeSec * alighting + boardTimeSec * boarding) / 60.0;
        if (s === borellaIdx) {
          borellaArrMin = arrAtStop;
          borellaDwellMin = dwellMin;
          borellaOnboardPax = onboardDests.length;
        }
        tCurr += dwellMin;
        stopTimeline.push({ stopName: legCfg.stops[s], arrMin: arrAtStop, depMin: tCurr, onboardPax: onboardDests.length });
      }

      const naturalDepMin = borellaArrMin + borellaDwellMin;
      return {
        legKey,
        routeCode: legCfg.code,
        role: legCfg.role,
        originName: legCfg.stops[0],
        destName: legCfg.stops[legCfg.stops.length - 1],
        tripId: trip.tripId,
        originSchedMin: trip.originSchedMin,
        borellaSchedMin: trip.borellaSchedMin,
        borellaArrMin,
        borellaDwellMin,
        borellaBaseDepMin: naturalDepMin,
        borellaActualDepMin: naturalDepMin,
        borellaHoldMin: 0,
        borellaOnboardPax,
        leftBehindTotal,
        transferPaxCount: 0,
        etaErrMin: 0,
        targetConnectorId: null,
        stopTimeline
      };
    });
  }

  function mapTargetConnectors(feeders, connectors) {
    const sortedConn = [...connectors].sort((a, b) => a.borellaSchedMin - b.borellaSchedMin);
    const targets = new Map();
    for (const f of feeders) {
      const target = sortedConn.find((c) => c.borellaSchedMin >= f.borellaSchedMin - EPS);
      f.targetConnectorId = target ? target.tripId : null;
      targets.set(f.tripId, f.targetConnectorId);
    }
    return targets;
  }

  function isSubset(subset, superset) {
    for (const item of subset) if (!superset.has(item)) return false;
    return true;
  }

  function resolveDirectionTransfers(direction, feeders, connectors, targets, localArrivalTimes, params) {
    const { policy, holdMaxMin, walkTimeMin, capacityPax } = params;
    const { passengerPatienceMin, ticketValidityMin, alternativeTravelPenaltyMin } = CFG.busParameters;
    const { waitWeight, holdWeight } = CFG.objectiveWeights;
    const isHoldingActive = policy !== "none" && holdMaxMin > 0;

    const connectorOrder = [...connectors].sort((a, b) => a.borellaSchedMin - b.borellaSchedMin);
    const connById = new Map(connectors.map((c) => [c.tripId, c]));
    const departed = new Set();
    const feederReady = new Map(feeders.map((f) => [f.tripId, f.borellaArrMin + walkTimeMin]));
    const feederById = new Map(feeders.map((f) => [f.tripId, f]));

    const protectedFeeders = new Map(connectors.map((c) => [c.tripId, new Set()]));
    for (const f of feeders) {
      const cid = targets.get(f.tripId);
      if (cid && protectedFeeders.has(cid)) protectedFeeders.get(cid).add(f.tripId);
    }
    const promisingFeeders = new Map();
    for (const c of connectors) {
      const prot = protectedFeeders.get(c.tripId);
      if (policy === "realtime" && isHoldingActive) {
        const latestDepMin = c.borellaBaseDepMin + holdMaxMin;
        promisingFeeders.set(c.tripId, new Set([...prot].filter((fid) => feederReady.get(fid) + feederById.get(fid).etaErrMin <= latestDepMin + EPS)));
      } else {
        promisingFeeders.set(c.tripId, prot);
      }
    }

    const events = [];
    let seq = 0;
    const pushEvent = (t, priority, type, id) => events.push({ t, priority, seq: seq++, type, id });
    const popEvent = () => {
      let best = 0;
      for (let i = 1; i < events.length; i++) {
        const e = events[i];
        const b = events[best];
        if (e.t < b.t || (e.t === b.t && (e.priority < b.priority || (e.priority === b.priority && e.seq < b.seq)))) best = i;
      }
      return events.splice(best, 1)[0];
    };
    for (const [fid, readyMin] of feederReady) pushEvent(readyMin, 0, "FEEDER_READY", fid);
    for (const c of connectors) pushEvent(c.borellaBaseDepMin, 1, "CONNECTOR_CHECK", c.tripId);

    const counts = { made: 0, missedTiming: 0, missedCapacity: 0, lostTiming: 0, lostCapacity: 0, outOfWindow: 0 };
    let waitMin = 0;
    let holdPaxMin = 0;
    let localAbandoned = 0;
    let waitingQueue = [];
    const readyFeeders = new Set();
    let localCursor = 0;
    let firstOpenIdx = 0;

    const transferEvents = new Map(
      feeders.map((f) => [
        f.tripId,
        {
          group: direction.label,
          feederId: f.tripId,
          fromRoute: f.routeCode,
          targetConnId: targets.get(f.tripId) || null,
          boardedConnId: null,
          startWalkMin: f.borellaArrMin,
          readyMin: f.borellaArrMin + walkTimeMin,
          paxCount: f.transferPaxCount,
          madeCount: 0,
          missedTimingCount: 0,
          missedCapCount: 0,
          lostCount: 0,
          targetHoldMin: 0
        }
      ])
    );

    function nextOpenConnector() {
      while (firstOpenIdx < connectorOrder.length && departed.has(connectorOrder[firstOpenIdx].tripId)) firstOpenIdx++;
      return firstOpenIdx < connectorOrder.length ? connectorOrder[firstOpenIdx] : null;
    }

    function willWaitForNextBus(nowMin, readyMin) {
      const next = nextOpenConnector();
      if (!next) return false;
      return next.borellaSchedMin - nowMin <= passengerPatienceMin && next.borellaSchedMin - readyMin <= ticketValidityMin;
    }

    function recordMiss(pax, reason) {
      const ev = transferEvents.get(pax.feederId);
      if (reason === "timing") {
        counts.missedTiming++;
        ev.missedTimingCount++;
      } else {
        counts.missedCapacity++;
        ev.missedCapCount++;
      }
    }

    function finalizeLost(pax, reason, nowMin) {
      recordMiss(pax, reason);
      if (reason === "timing") counts.lostTiming++;
      else counts.lostCapacity++;
      transferEvents.get(pax.feederId).lostCount++;
      waitMin += nowMin - pax.readyMin + alternativeTravelPenaltyMin;
    }

    function finalizeBoarded(pax, conn, depMin) {
      waitMin += Math.max(0, depMin - pax.readyMin);
      const ev = transferEvents.get(pax.feederId);
      ev.boardedConnId = conn.tripId;
      if (pax.missReason === null) {
        counts.made++;
        ev.madeCount++;
      } else {
        recordMiss(pax, pax.missReason);
      }
    }

    function departConnector(conn, depMin) {
      if (departed.has(conn.tripId)) return;
      departed.add(conn.tripId);
      const holdMin = Math.max(0, depMin - conn.borellaBaseDepMin);
      holdPaxMin += conn.borellaOnboardPax * holdMin;
      conn.borellaActualDepMin = depMin;
      conn.borellaHoldMin = holdMin;
      const shiftMin = depMin - (conn.borellaArrMin + conn.borellaDwellMin);
      if (shiftMin > 0) {
        const bIdx = CFG.routes[conn.legKey].borellaStopIndex;
        conn.stopTimeline[bIdx].depMin += shiftMin;
        for (let s = bIdx + 1; s < conn.stopTimeline.length; s++) {
          conn.stopTimeline[s].arrMin += shiftMin;
          conn.stopTimeline[s].depMin += shiftMin;
        }
      }

      let nLocalPresent = 0;
      while (localCursor + nLocalPresent < localArrivalTimes.length && localArrivalTimes[localCursor + nLocalPresent] <= depMin + EPS) nLocalPresent++;
      const boardingQueue = [];
      for (let k = 0; k < nLocalPresent; k++) boardingQueue.push({ t: localArrivalTimes[localCursor + k], kind: 1, idx: -1 });
      waitingQueue.forEach((pax, idx) => boardingQueue.push({ t: pax.readyMin, kind: 0, idx }));
      boardingQueue.sort((a, b) => a.t - b.t || a.kind - b.kind || a.idx - b.idx);
      const freeSeats = capacityPax === null ? boardingQueue.length : Math.max(0, capacityPax - conn.borellaOnboardPax);
      const boarded = boardingQueue.slice(0, freeSeats);
      const boardedTransferIdx = new Set(boarded.filter((x) => x.kind === 0).map((x) => x.idx));
      const nLocalBoarded = boarded.filter((x) => x.kind === 1).length;

      const remainingQueue = [];
      waitingQueue.forEach((pax, idx) => {
        if (boardedTransferIdx.has(idx)) {
          finalizeBoarded(pax, conn, depMin);
          return;
        }
        if (pax.missReason === null && pax.targetCid === conn.tripId) pax.missReason = "capacity";
        if (pax.missReason === null || willWaitForNextBus(depMin, pax.readyMin)) remainingQueue.push(pax);
        else finalizeLost(pax, pax.missReason, depMin);
      });
      waitingQueue = remainingQueue;

      const nLocalLeft = nLocalPresent - nLocalBoarded;
      if (nLocalLeft > 0 && !willWaitForNextBus(depMin, depMin)) {
        localAbandoned += nLocalLeft;
        localCursor += nLocalPresent;
      } else {
        localCursor += nLocalBoarded;
      }
    }

    while (events.length > 0) {
      const { t, type, id } = popEvent();
      if (type === "FEEDER_READY") {
        readyFeeders.add(id);
        const nPax = feederById.get(id).transferPaxCount;
        const targetCid = targets.get(id);
        if (!targetCid) {
          counts.outOfWindow += nPax;
          continue;
        }
        const target = connById.get(targetCid);
        if (departed.has(targetCid)) {
          const stays = willWaitForNextBus(t, t);
          for (let k = 0; k < nPax; k++) {
            const pax = { readyMin: t, targetCid, missReason: "timing", feederId: id };
            if (stays) waitingQueue.push(pax);
            else finalizeLost(pax, "timing", t);
          }
          continue;
        }
        for (let k = 0; k < nPax; k++) waitingQueue.push({ readyMin: t, targetCid, missReason: null, feederId: id });
        const promising = promisingFeeders.get(targetCid);
        if (t >= target.borellaBaseDepMin - EPS && promising.has(id) && isSubset(promising, readyFeeders)) departConnector(target, t);
      } else {
        const conn = connById.get(id);
        if (departed.has(id)) continue;
        const deadlineMin = conn.borellaBaseDepMin + holdMaxMin;
        if (!isHoldingActive || isSubset(promisingFeeders.get(id), readyFeeders) || t >= deadlineMin - EPS) departConnector(conn, t);
        else pushEvent(deadlineMin, 1, "CONNECTOR_CHECK", id);
      }
    }

    for (const pax of waitingQueue) finalizeLost(pax, pax.missReason || "timing", pax.readyMin);

    for (const ev of transferEvents.values()) {
      if (ev.targetConnId) ev.targetHoldMin = connById.get(ev.targetConnId).borellaHoldMin;
    }

    const inWindow = counts.made + counts.missedTiming + counts.missedCapacity;
    const walkMin = walkTimeMin * inWindow;
    const waitCost = waitWeight * (walkMin + waitMin + counts.outOfWindow * alternativeTravelPenaltyMin);
    const holdCost = holdWeight * holdPaxMin;
    return {
      ...counts,
      missedTotal: counts.missedTiming + counts.missedCapacity,
      lostTotal: counts.lostTiming + counts.lostCapacity,
      inWindow,
      waitCost,
      holdCost,
      totalCost: waitCost + holdCost,
      localAbandoned,
      transferEvents: [...transferEvents.values()]
    };
  }

  function simulateFullDay(params, rng) {
    const matOff = buildParametricTransitionMatrix(calibrateJamParamBisection(CFG.trafficModel.targetSpeedOffpeakKmph));
    const matPeak = buildParametricTransitionMatrix(calibrateJamParamBisection(params.peakSpeedKmph));
    const alphas = CFG.notebookReference.calibratedAlphas;
    const shiftByRoute = { CM01: params.shiftRoute === "CM01" ? params.shiftMin : 0, CM03: params.shiftRoute === "CM03" ? params.shiftMin : 0 };

    const traffic = {};
    const legs = {};
    const localArrivals = {};
    for (const legKey of LEG_ORDER) {
      const legCfg = CFG.routes[legKey];
      const schedTrips = buildScheduledLegTrips(legKey, shiftByRoute[legCfg.code]);
      traffic[legKey] = generateDailyTrafficGrid(rng, matOff, matPeak);
      const queues = generateStopArrivals(legCfg, schedTrips[0].originSchedMin, rng);
      const deferredStopIdx = CONNECTOR_LEGS.has(legKey) ? legCfg.borellaStopIndex : -1;
      legs[legKey] = simulateLegDay(legKey, schedTrips, traffic[legKey], queues, alphas[legKey], params.capacityPax, CFG.busParameters.passengerPatienceMin, deferredStopIdx);
      if (CONNECTOR_LEGS.has(legKey)) localArrivals[legKey] = queues[legCfg.borellaStopIndex].map((p) => p.arrMin);
    }

    for (const direction of TRANSFER_DIRECTIONS) {
      for (const f of legs[direction.feederLeg]) {
        f.transferPaxCount = samplePoissonKnuth(CFG.busParameters.transferMeanPax, rng);
        f.etaErrMin = CFG.busParameters.etaNoiseSdMin * sampleStandardNormalBoxMuller(rng);
      }
    }

    const results = {};
    for (const direction of TRANSFER_DIRECTIONS) {
      const feeders = legs[direction.feederLeg];
      const connectors = legs[direction.connectorLeg];
      const targets = mapTargetConnectors(feeders, connectors);
      results[direction.group] = resolveDirectionTransfers(direction, feeders, connectors, targets, localArrivals[direction.connectorLeg], params);
    }

    const resA = results.A;
    const resB = results.B;
    const inWindowAll = resA.inWindow + resB.inWindow;
    const pct = (num, den) => (den > 0 ? (100.0 * num) / den : 0);
    return {
      traffic,
      buses: LEG_ORDER.flatMap((legKey) => legs[legKey]),
      transferEvents: [...resA.transferEvents, ...resB.transferEvents].sort((a, b) => a.readyMin - b.readyMin),
      resA,
      resB,
      missRateAllPct: pct(resA.missedTotal + resB.missedTotal, inWindowAll),
      missRateAPct: pct(resA.missedTotal, resA.inWindow),
      missRateBPct: pct(resB.missedTotal, resB.inWindow),
      lostRatePct: pct(resA.lostTotal + resB.lostTotal, inWindowAll),
      waitCostTotal: resA.waitCost + resB.waitCost,
      holdCostTotal: resA.holdCost + resB.holdCost,
      objectiveJ: resA.totalCost + resB.totalCost
    };
  }

  function computeMeanAndCi(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, ci: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    if (n === 1) return { mean, ci: 0 };
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    return { mean, ci: (1.96 * Math.sqrt(variance)) / Math.sqrt(n) };
  }

  root.SimEngine = {
    createSeededRng,
    formatMinutesToHhmm,
    isPeakTime,
    getTrafficStateAt,
    simulateFullDay,
    computeMeanAndCi
  };
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  "use strict";

  const CFG = window.SIM_CONFIG;
  const $ = (id) => document.getElementById(id);

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
    for (let iter = 0; iter < 60; iter++) {
      const next = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          next[j] += pi[i] * matrix[i][j];
        }
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
    for (let i = 0; i < 40; i++) {
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

  function generateDailyTrafficGrid(rng, matrixOffpeak, matrixPeak) {
    const { dayStartMin, dayEndMin, trafficStepMin } = CFG.timeWindow;
    const nSlots = Math.floor((dayEndMin - dayStartMin) / trafficStepMin) + 20;
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
    while (remainingKm > 1e-9) {
      let slot = Math.max(0, Math.floor((currentTimeMin - dayStartMin) / trafficStepMin));
      slot = Math.min(slot, trafficStates.length - 1);
      const slotEndMin = dayStartMin + (slot + 1) * trafficStepMin;
      const availMin = Math.max(0.02, slotEndMin - currentTimeMin);
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

  function buildScheduledLegTrips(legKey, shiftMin) {
    const rawTrips = CFG.timetables[legKey];
    const frac = CFG.busParameters.borellaInterpolationFraction;
    return rawTrips.map((row) => {
      const mins = row.times.map((t) => parseHhmmToMinutes(t) + shiftMin);
      let prevMin, nextMin;
      if (legKey === "CM01_MAK_to_FOR") {
        prevMin = mins[2];
        nextMin = mins[3];
      } else if (legKey === "CM01_FOR_to_MAK") {
        prevMin = mins[2];
        nextMin = mins[3];
      } else if (legKey === "CM03_MAK_to_KAD") {
        prevMin = mins[3];
        nextMin = mins[4];
      } else {
        prevMin = mins[2];
        nextMin = mins[3];
      }
      return {
        tripId: row.tripId,
        originSchedMin: mins[0],
        borellaSchedMin: prevMin + frac * (nextMin - prevMin),
        destSchedMin: mins[mins.length - 1]
      };
    });
  }

  function generateStopArrivals(legCfg, rng) {
    const nStops = legCfg.stops.length;
    const queues = Array.from({ length: nStops }, () => []);
    const { dayStartMin, dayEndMin } = CFG.timeWindow;
    for (let s = 0; s < nStops - 1; s++) {
      const baseRate = legCfg.baseArrivalRatePaxPerMin[s];
      if (baseRate <= 0) continue;
      let t = dayStartMin;
      while (t < dayEndMin) {
        const rate = baseRate * (isPeakTime(t) ? 1.35 : 0.85);
        t += sampleExponentialInterarrival(rate, rng);
        if (t < dayEndMin) {
          const nDown = nStops - 1 - s;
          const destIdx = s + 1 + Math.min(Math.floor(rng() * nDown), nDown - 1);
          queues[s].push({ arrMin: t, destIdx });
        }
      }
    }
    return queues;
  }

  function simulateLegDay(legKey, shiftMin, trafficStates, rng, capacityPax) {
    const legCfg = CFG.routes[legKey];
    const schedTrips = buildScheduledLegTrips(legKey, shiftMin);
    const queues = generateStopArrivals(legCfg, rng);
    const cursors = new Array(legCfg.stops.length).fill(0);
    const alpha = CFG.trafficModel.legSpeedAlpha[legKey];
    const { doorTimeSec, alightTimeSec, boardTimeSec } = CFG.busParameters;
    const borellaIdx = legCfg.borellaStopIndex;

    return schedTrips.map((trip) => {
      let tCurr = trip.originSchedMin;
      let onboardDests = [];
      let leftBehindTotal = 0;
      const stopTimeline = [];
      let borellaArrMin = tCurr;
      let borellaDwellMin = 0.5;
      let borellaOnboardPax = 0;

      for (let s = 0; s < legCfg.stops.length; s++) {
        if (s > 0) {
          const dKm = legCfg.segmentDistancesKm[s - 1];
          tCurr += travelSegmentMinutes(tCurr, dKm, trafficStates, alpha);
        }
        const arrAtStop = tCurr;
        let alighting = 0;
        const remaining = [];
        for (const d of onboardDests) {
          if (d === s) alighting++;
          else remaining.push(d);
        }
        onboardDests = remaining;

        const q = queues[s];
        let c = cursors[s];
        let waiting = 0;
        while (c + waiting < q.length && q[c + waiting].arrMin <= tCurr) {
          waiting++;
        }
        const freeSeats = Math.max(0, capacityPax - onboardDests.length);
        const boarding = Math.min(waiting, freeSeats);
        leftBehindTotal += waiting - boarding;
        for (let k = 0; k < boarding; k++) {
          onboardDests.push(q[c + k].destIdx);
        }
        cursors[s] = c + boarding;

        const dwellMin = (doorTimeSec + alightTimeSec * alighting + boardTimeSec * boarding) / 60.0;
        if (s === borellaIdx) {
          borellaArrMin = arrAtStop;
          borellaDwellMin = dwellMin;
          borellaOnboardPax = onboardDests.length;
        }
        tCurr += dwellMin;
        stopTimeline.push({
          stopName: legCfg.stops[s],
          arrMin: arrAtStop,
          depMin: tCurr,
          onboardPax: onboardDests.length
        });
      }

      return {
        legKey,
        routeCode: legCfg.code,
        tripId: trip.tripId,
        originSchedMin: trip.originSchedMin,
        borellaSchedMin: trip.borellaSchedMin,
        borellaArrMin,
        borellaBaseDepMin: Math.max(trip.borellaSchedMin, borellaArrMin + borellaDwellMin),
        borellaActualDepMin: Math.max(trip.borellaSchedMin, borellaArrMin + borellaDwellMin),
        borellaHoldMin: 0,
        borellaOnboardPax,
        leftBehindTotal,
        transferPaxCount: samplePoissonKnuth(CFG.busParameters.transferMeanPax, rng),
        targetConnectorId: null,
        stopTimeline
      };
    });
  }

  function mapTargetConnectors(feeders, connectors, walkTimeMin) {
    const sortedConn = [...connectors].sort((a, b) => a.borellaSchedMin - b.borellaSchedMin);
    const map = new Map();
    for (const f of feeders) {
      const readySched = f.borellaSchedMin + walkTimeMin;
      const target = sortedConn.find((c) => c.borellaSchedMin >= readySched);
      f.targetConnectorId = target ? target.tripId : null;
      map.set(f.tripId, f.targetConnectorId);
    }
    return map;
  }

  function resolveDirectionTransfers(groupLabel, feeders, connectors, params) {
    const { policy, holdMaxMin, walkTimeMin, capacityPax } = params;
    const { waitWeight, holdWeight } = CFG.objectiveWeights;
    mapTargetConnectors(feeders, connectors, walkTimeMin);

    const connById = new Map(connectors.map((c) => [c.tripId, c]));
    const protectedByConn = new Map(connectors.map((c) => [c.tripId, []]));

    for (const f of feeders) {
      if (f.targetConnectorId && protectedByConn.has(f.targetConnectorId)) {
        protectedByConn.get(f.targetConnectorId).push(f);
      }
    }

    for (const c of connectors) {
      let depMin = c.borellaBaseDepMin;
      if (policy !== "none" && holdMaxMin > 0) {
        const deadline = c.borellaSchedMin + holdMaxMin;
        if (c.borellaBaseDepMin < deadline) {
          const protFeeders = protectedByConn.get(c.tripId) || [];
          let latestCatchableReady = c.borellaBaseDepMin;
          for (const f of protFeeders) {
            const readyActual = f.borellaArrMin + walkTimeMin;
            if (readyActual > c.borellaBaseDepMin) {
              if (policy === "realtime" && readyActual > deadline) {
                continue;
              }
              if (readyActual > latestCatchableReady) {
                latestCatchableReady = readyActual;
              }
            }
          }
          depMin = Math.min(deadline, Math.max(c.borellaBaseDepMin, latestCatchableReady));
        }
      }
      c.borellaActualDepMin = depMin;
      c.borellaHoldMin = Math.max(0, depMin - c.borellaBaseDepMin);

      const bIdx = CFG.routes[c.legKey].borellaStopIndex;
      const shiftDelta = c.borellaHoldMin;
      if (shiftDelta > 0) {
        c.stopTimeline[bIdx].depMin += shiftDelta;
        for (let s = bIdx + 1; s < c.stopTimeline.length; s++) {
          c.stopTimeline[s].arrMin += shiftDelta;
          c.stopTimeline[s].depMin += shiftDelta;
        }
      }
    }

    const sortedConn = [...connectors].sort((a, b) => a.borellaActualDepMin - b.borellaActualDepMin);
    const seatsLeft = new Map(sortedConn.map((c) => [c.tripId, Math.max(0, capacityPax - c.borellaOnboardPax)]));

    let made = 0;
    let missedTiming = 0;
    let missedCapacity = 0;
    let outOfWindow = 0;
    let totalWaitMin = 0;
    let totalHoldPaxMin = 0;
    const transferEvents = [];

    for (const c of sortedConn) {
      totalHoldPaxMin += c.borellaOnboardPax * c.borellaHoldMin;
    }

    for (const f of [...feeders].sort((a, b) => a.borellaArrMin - b.borellaArrMin)) {
      const nPax = f.transferPaxCount;
      if (!f.targetConnectorId) {
        outOfWindow += nPax;
        continue;
      }
      const readyMin = f.borellaArrMin + walkTimeMin;
      const targetConn = connById.get(f.targetConnectorId);
      const timingOk = readyMin <= targetConn.borellaActualDepMin + 1e-6;
      const candidateConns = sortedConn.filter((c) => c.borellaActualDepMin >= readyMin - 1e-6);

      let fMade = 0;
      let fMissTiming = 0;
      let fMissCap = 0;
      let boardedConnId = null;

      for (let p = 0; p < nPax; p++) {
        const boarded = candidateConns.find((c) => seatsLeft.get(c.tripId) > 0);
        if (boarded) {
          seatsLeft.set(boarded.tripId, seatsLeft.get(boarded.tripId) - 1);
          boardedConnId = boarded.tripId;
          const waitMin = Math.max(0, boarded.borellaActualDepMin - readyMin);
          totalWaitMin += waitMin;
          if (boarded.borellaSchedMin <= targetConn.borellaSchedMin && timingOk) {
            made++;
            fMade++;
          } else if (!timingOk) {
            missedTiming++;
            fMissTiming++;
          } else {
            missedCapacity++;
            fMissCap++;
          }
        } else {
          totalWaitMin += 45.0;
          if (!timingOk) {
            missedTiming++;
            fMissTiming++;
          } else {
            missedCapacity++;
            fMissCap++;
          }
        }
      }

      transferEvents.push({
        group: groupLabel,
        feederId: f.tripId,
        fromRoute: f.routeCode,
        targetConnId: f.targetConnectorId,
        boardedConnId,
        startWalkMin: f.borellaArrMin,
        readyMin,
        paxCount: nPax,
        madeCount: fMade,
        missedTimingCount: fMissTiming,
        missedCapCount: fMissCap,
        targetHoldMin: targetConn.borellaHoldMin
      });
    }

    const inWindow = made + missedTiming + missedCapacity;
    return {
      made,
      missedTiming,
      missedCapacity,
      missedTotal: missedTiming + missedCapacity,
      outOfWindow,
      inWindow,
      waitCost: waitWeight * totalWaitMin,
      holdCost: holdWeight * totalHoldPaxMin,
      totalCost: waitWeight * totalWaitMin + holdWeight * totalHoldPaxMin,
      transferEvents
    };
  }

  function simulateFullDay(params, rng) {
    const pOff = calibrateJamParamBisection(CFG.trafficModel.targetSpeedOffpeakKmph);
    const pPeak = calibrateJamParamBisection(params.peakSpeedKmph);
    const matOff = buildParametricTransitionMatrix(pOff);
    const matPeak = buildParametricTransitionMatrix(pPeak);

    const traffic = {
      CM01_MAK_to_FOR: generateDailyTrafficGrid(rng, matOff, matPeak),
      CM01_FOR_to_MAK: generateDailyTrafficGrid(rng, matOff, matPeak),
      CM03_MAK_to_KAD: generateDailyTrafficGrid(rng, matOff, matPeak),
      CM03_KAD_to_MAK: generateDailyTrafficGrid(rng, matOff, matPeak)
    };

    const shift01 = params.shiftRoute === "CM01" ? params.shiftMin : 0;
    const shift03 = params.shiftRoute === "CM03" ? params.shiftMin : 0;

    const cm01Mak = simulateLegDay("CM01_MAK_to_FOR", shift01, traffic.CM01_MAK_to_FOR, rng, params.capacityPax);
    const cm01For = simulateLegDay("CM01_FOR_to_MAK", shift01, traffic.CM01_FOR_to_MAK, rng, params.capacityPax);
    const cm03Mak = simulateLegDay("CM03_MAK_to_KAD", shift03, traffic.CM03_MAK_to_KAD, rng, params.capacityPax);
    const cm03Kad = simulateLegDay("CM03_KAD_to_MAK", shift03, traffic.CM03_KAD_to_MAK, rng, params.capacityPax);

    const resA = resolveDirectionTransfers("Group A (KAD->FOR)", cm03Kad, cm01Mak, params);
    const resB = resolveDirectionTransfers("Group B (FOR->KAD)", cm01For, cm03Mak, params);

    const inWindowAll = resA.inWindow + resB.inWindow;
    const missedAll = resA.missedTotal + resB.missedTotal;

    return {
      traffic,
      buses: [...cm01Mak, ...cm01For, ...cm03Mak, ...cm03Kad],
      transferEvents: [...resA.transferEvents, ...resB.transferEvents].sort((a, b) => a.readyMin - b.readyMin),
      resA,
      resB,
      missRateAllPct: inWindowAll > 0 ? (100.0 * missedAll) / inWindowAll : 0,
      missRateAPct: resA.inWindow > 0 ? (100.0 * resA.missedTotal) / resA.inWindow : 0,
      missRateBPct: resB.inWindow > 0 ? (100.0 * resB.missedTotal) / resB.inWindow : 0,
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

  const state = {
    rng: null,
    running: false,
    animId: null,
    dayIndex: 1,
    simClockMin: CFG.timeWindow.dayStartMin,
    currentDay: null,
    missAllHistory: [],
    missAHistory: [],
    missBHistory: [],
    objHistory: [],
    waitCostHistory: [],
    holdCostHistory: [],
    convergenceTrace: []
  };

  const canvas = $("mapCanvas");
  const ctx = canvas.getContext("2d");

  function readUIParams() {
    return {
      policy: $("policy").value,
      holdMaxMin: parseFloat($("holdMax").value),
      shiftRoute: $("shiftRoute").value,
      shiftMin: parseFloat($("shiftMin").value),
      walkTimeMin: parseFloat($("walkTime").value),
      capacityPax: parseInt($("capacityPax").value, 10),
      peakSpeedKmph: parseFloat($("peakSpeed").value),
      animSpeed: parseFloat($("animSpeed").value),
      repTotal: parseInt($("repTotal").value, 10),
      seed: Math.max(1, parseInt($("seed").value, 10) || CFG.seed)
    };
  }

  function updateControlReadouts() {
    const p = readUIParams();
    $("holdMaxVal").textContent = `${p.holdMaxMin.toFixed(1)} min`;
    $("shiftMinVal").textContent = `${p.shiftMin > 0 ? "+" : ""}${p.shiftMin} min`;
    $("walkTimeVal").textContent = `${p.walkTimeMin.toFixed(1)} min`;
    $("capacityPaxVal").textContent = `${p.capacityPax} pax`;
    $("peakSpeedVal").textContent = `${p.peakSpeedKmph.toFixed(0)} km/h`;
    $("animSpeedVal").textContent = `${p.animSpeed.toFixed(1)}x`;
    $("repTotalVal").textContent = `${p.repTotal} days`;
  }

  function getBusPositionAtTime(bus, tMin) {
    const tl = bus.stopTimeline;
    if (tMin < tl[0].arrMin || tMin > tl[tl.length - 1].depMin) return null;

    for (let i = 0; i < tl.length; i++) {
      const stop = tl[i];
      if (tMin >= stop.arrMin && tMin <= stop.depMin) {
        const pt = CFG.mapCoordinates[stop.stopName];
        const nextPt = i < tl.length - 1 ? CFG.mapCoordinates[tl[i + 1].stopName] : CFG.mapCoordinates[tl[i - 1].stopName];
        const angleRad = i < tl.length - 1
          ? Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x)
          : Math.atan2(pt.y - nextPt.y, pt.x - nextPt.x);
        const isBorellaHold = stop.stopName.includes("Borella") && bus.borellaHoldMin > 0.05 && tMin > bus.borellaBaseDepMin;
        return {
          x: pt.x,
          y: pt.y,
          angleRad,
          onboardPax: stop.onboardPax,
          status: isBorellaHold ? "HOLDING" : "DWELL",
          stopName: stop.stopName
        };
      }
      if (i < tl.length - 1 && tMin > stop.depMin && tMin < tl[i + 1].arrMin) {
        const nextStop = tl[i + 1];
        const frac = (tMin - stop.depMin) / Math.max(0.1, nextStop.arrMin - stop.depMin);
        const p1 = CFG.mapCoordinates[stop.stopName];
        const p2 = CFG.mapCoordinates[nextStop.stopName];
        return {
          x: p1.x + (p2.x - p1.x) * frac,
          y: p1.y + (p2.y - p1.y) * frac,
          angleRad: Math.atan2(p2.y - p1.y, p2.x - p1.x),
          onboardPax: stop.onboardPax,
          status: "CRUISING",
          stopName: nextStop.stopName
        };
      }
    }
    return null;
  }

  function drawSmoothMapBackground() {
    ctx.save();
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, canvas.width, 420);

    ctx.fillStyle = "#dbeafe";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(118, 0);
    ctx.quadraticCurveTo(84, 130, 58, 215);
    ctx.quadraticCurveTo(42, 315, 28, 420);
    ctx.lineTo(0, 420);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#bfdbfe";
    ctx.beginPath();
    ctx.ellipse(545, 272, 34, 14, -0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#3b82f6";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.fillText("Indian Ocean", 10, 235);
    ctx.fillText("Diyawanna Lake", 510, 298);
    ctx.restore();
  }

  function drawCorridorPolyline(stopNames, routeColor, trafficState) {
    const stateColors = ["#22c55e", "#f59e0b", "#ef4444"];
    const tracePath = () => {
      ctx.beginPath();
      stopNames.forEach((name, idx) => {
        const pt = CFG.mapCoordinates[name];
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
    };

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = stateColors[trafficState];
    ctx.lineWidth = 22;
    ctx.globalAlpha = 0.28;
    tracePath();
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    ctx.strokeStyle = routeColor;
    ctx.lineWidth = 15;
    tracePath();
    ctx.stroke();

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 11;
    tracePath();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 7]);
    tracePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTopDownBus(pos, isCm01, isHold, capacityPax) {
    const laneOffset = 5.5;
    const nx = -Math.sin(pos.angleRad) * laneOffset;
    const ny = Math.cos(pos.angleRad) * laneOffset;
    const bx = pos.x + nx;
    const by = pos.y + ny;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(pos.angleRad);

    ctx.shadowColor = "rgba(15, 23, 42, 0.25)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = isHold ? "#f59e0b" : isCm01 ? "#0284c7" : "#7c3aed";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-12, -5.5, 24, 11, 3.5);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.roundRect(5.5, -3.8, 4, 7.6, 1.2);
    ctx.fill();
    ctx.restore();

    const capRatio = Math.min(1, pos.onboardPax / Math.max(1, capacityPax));
    const fillCol = capRatio >= 0.98 ? "#dc2626" : capRatio >= 0.7 ? "#d97706" : "#16a34a";

    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.strokeStyle = isHold ? "#d97706" : "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx - 12, by - 21, 24, 11, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = fillCol;
    ctx.fillRect(bx - 9, by - 12.2, 18 * capRatio, 1.8);

    ctx.fillStyle = "#0f172a";
    ctx.font = "700 8px system-ui, sans-serif";
    ctx.fillText(`${pos.onboardPax}`, bx - 5.5, by - 13);

    if (isHold) {
      ctx.fillStyle = "#b45309";
      ctx.font = "700 9px system-ui, sans-serif";
      ctx.fillText("HOLD", bx - 12, by - 24);
    }
    ctx.restore();
  }

  function drawBorellaInset(day, tNow, params, activeHoldingBus) {
    const bx = 18;
    const by = 292;
    const bw = 248;
    const bh = 112;

    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.12)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText("Borella Interchange Zoom", bx + 12, by + 19);

    const stopYmba = { x: bx + 52, y: by + 45 };
    const stopSinger = { x: bx + 196, y: by + 45 };

    ctx.strokeStyle = "#64748b";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(stopYmba.x, stopYmba.y);
    ctx.lineTo(stopSinger.x, stopSinger.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#7c3aed";
    ctx.beginPath();
    ctx.arc(stopYmba.x, stopYmba.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.arc(stopSinger.x, stopSinger.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#475569";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.fillText("YMBA (CM03)", bx + 18, by + 65);
    ctx.fillText("Singer (CM01)", bx + 162, by + 65);

    if (day) {
      for (const ev of day.transferEvents) {
        if (tNow >= ev.startWalkMin && tNow < ev.readyMin) {
          const frac = (tNow - ev.startWalkMin) / Math.max(0.2, ev.readyMin - ev.startWalkMin);
          const x = ev.fromRoute === "CM03"
            ? stopYmba.x + (stopSinger.x - stopYmba.x) * frac
            : stopSinger.x + (stopYmba.x - stopSinger.x) * frac;
          ctx.fillStyle = ev.madeCount > 0 ? "#16a34a" : "#dc2626";
          ctx.beginPath();
          ctx.arc(x, stopYmba.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const barX = bx + 12;
    const barY = by + 79;
    const barW = bw - 24;
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, 20, 4);
    ctx.fill();

    if (activeHoldingBus) {
      const elapsed = Math.max(0, tNow - activeHoldingBus.borellaBaseDepMin);
      const maxH = Math.max(0.5, params.holdMaxMin);
      const fillFrac = Math.min(1, elapsed / maxH);
      ctx.fillStyle = "#d97706";
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW * fillFrac, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.fillText(
        `HOLDING ${activeHoldingBus.tripId}: ${elapsed.toFixed(1)} / ${maxH.toFixed(1)}m`,
        barX + 8,
        barY + 13
      );
    } else {
      ctx.fillStyle = "#475569";
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.fillText(`Walk time: ${params.walkTimeMin.toFixed(1)} min | No active hold`, barX + 8, barY + 13);
    }
    ctx.restore();
  }

  function renderCanvasAndTables() {
    const w = canvas.width;
    const h = canvas.height;
    const mapH = 420;
    const params = readUIParams();

    drawSmoothMapBackground();

    const day = state.currentDay;
    const tNow = state.simClockMin;
    const st01 = day ? getTrafficStateAt(day.traffic.CM01_MAK_to_FOR, tNow) : 0;
    const st03 = day ? getTrafficStateAt(day.traffic.CM03_MAK_to_KAD, tNow) : 0;

    drawCorridorPolyline(CFG.routes.CM03_MAK_to_KAD.stops, "#7c3aed", st03);
    drawCorridorPolyline(CFG.routes.CM01_FOR_to_MAK.stops, "#0284c7", st01);

    const bSinger = CFG.mapCoordinates["Borella (Singer Mega)"];
    const bYmba = CFG.mapCoordinates["Borella 02 (YMBA)"];
    ctx.strokeStyle = "#f59e0b";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bYmba.x, bYmba.y);
    ctx.lineTo(bSinger.x, bSinger.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const [name, pt] of Object.entries(CFG.mapCoordinates)) {
      ctx.fillStyle = pt.isBorella ? "#fef3c7" : "#ffffff";
      ctx.strokeStyle = pt.isBorella ? "#d97706" : "#475569";
      ctx.lineWidth = pt.isBorella ? 3 : 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.isBorella ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pt.isBorella ? "#92400e" : "#1e293b";
      ctx.font = pt.isBorella ? "700 10.5px system-ui, sans-serif" : "600 10px system-ui, sans-serif";
      ctx.fillText(name, pt.x + (pt.ldx || -24), pt.y + (pt.ldy || 15));
    }

    let activeBusesCount = 0;
    let walkingPaxCount = 0;
    let madeSoFar = 0;
    let missedSoFar = 0;
    let activeHoldingBus = null;

    if (day) {
      for (const ev of day.transferEvents) {
        if (tNow >= ev.readyMin) {
          madeSoFar += ev.madeCount;
          missedSoFar += ev.missedTimingCount + ev.missedCapCount;
          if (tNow - ev.readyMin < 14) {
            const ageFrac = (tNow - ev.readyMin) / 14;
            const pulsePt = ev.fromRoute === "CM03" ? bSinger : bYmba;
            const pulseY = pulsePt.y - 20 - ageFrac * 18;
            ctx.save();
            ctx.globalAlpha = 1.0 - ageFrac;
            ctx.font = "700 11px system-ui, sans-serif";
            if (ev.madeCount > 0) {
              ctx.fillStyle = "#16a34a";
              ctx.fillText(`+${ev.madeCount} MADE`, pulsePt.x + 14, pulseY);
            }
            const mTot = ev.missedTimingCount + ev.missedCapCount;
            if (mTot > 0) {
              ctx.fillStyle = "#dc2626";
              ctx.fillText(`-${mTot} MISSED`, pulsePt.x + 14, pulseY + 13);
            }
            ctx.restore();
          }
        } else if (tNow >= ev.startWalkMin) {
          walkingPaxCount += ev.paxCount;
          const frac = (tNow - ev.startWalkMin) / Math.max(0.2, ev.readyMin - ev.startWalkMin);
          const pStart = ev.fromRoute === "CM03" ? bYmba : bSinger;
          const pEnd = ev.fromRoute === "CM03" ? bSinger : bYmba;
          const px = pStart.x + (pEnd.x - pStart.x) * frac;
          const py = pStart.y + (pEnd.y - pStart.y) * frac;
          ctx.fillStyle = ev.madeCount > 0 ? "#16a34a" : "#dc2626";
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const bus of day.buses) {
        const pos = getBusPositionAtTime(bus, tNow);
        if (!pos) continue;
        activeBusesCount++;
        const isHold = pos.status === "HOLDING";
        if (isHold) activeHoldingBus = bus;
        drawTopDownBus(pos, bus.routeCode === "CM01", isHold, params.capacityPax);
      }
    }

    drawBorellaInset(day, tNow, params, activeHoldingBus);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, mapH, w, h - mapH);
    ctx.strokeStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(0, mapH);
    ctx.lineTo(w, mapH);
    ctx.stroke();

    const plotL = 56;
    const plotR = 570;
    const plotT = mapH + 30;
    const plotB = h - 24;
    const plotW = plotR - plotL;
    const plotH = plotB - plotT;

    ctx.fillStyle = "#0f172a";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText("Convergence: Missed Transfers (% +/- 95% CI)", 18, mapH + 19);
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.roundRect(plotL, plotT, plotW, plotH, 8);
    ctx.stroke();

    for (let pct = 0; pct <= 100; pct += 25) {
      const y = plotB - (pct / 100) * plotH;
      ctx.strokeStyle = "#f1f5f9";
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotR, y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`${pct}%`, 22, y + 3);
    }

    const targetR = params.repTotal;
    if (state.convergenceTrace.length > 1) {
      ctx.fillStyle = "rgba(2, 132, 199, 0.16)";
      ctx.beginPath();
      state.convergenceTrace.forEach((pt, idx) => {
        const x = plotL + (pt.day / targetR) * plotW;
        const y = plotB - (Math.min(100, pt.mean + pt.ci) / 100) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let idx = state.convergenceTrace.length - 1; idx >= 0; idx--) {
        const pt = state.convergenceTrace[idx];
        const x = plotL + (pt.day / targetR) * plotW;
        const y = plotB - (Math.max(0, pt.mean - pt.ci) / 100) * plotH;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 2;
      ctx.beginPath();
      state.convergenceTrace.forEach((pt, idx) => {
        const x = plotL + (pt.day / targetR) * plotW;
        const y = plotB - (pt.mean / 100) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    const barAreaX = 605;
    const barAreaW = w - barAreaX - 24;
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText("Objective J Cost Breakdown (pax-min)", barAreaX, mapH + 19);

    const meanWait = state.waitCostHistory.length > 0
      ? computeMeanAndCi(state.waitCostHistory).mean
      : (day ? day.waitCostTotal : 0);
    const meanHold = state.holdCostHistory.length > 0
      ? computeMeanAndCi(state.holdCostHistory).mean
      : (day ? day.holdCostTotal : 0);
    const maxBar = Math.max(100, meanWait + meanHold);

    ctx.fillStyle = "#475569";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`Transfer Wait Cost (2.0x): ${meanWait.toFixed(0)}`, barAreaX, mapH + 46);
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.roundRect(barAreaX, mapH + 54, barAreaW, 18, 4);
    ctx.fill();
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.roundRect(barAreaX, mapH + 54, barAreaW * (meanWait / maxBar), 18, 4);
    ctx.fill();

    ctx.fillStyle = "#475569";
    ctx.fillText(`On-Board Hold Cost (1.0x): ${meanHold.toFixed(0)}`, barAreaX, mapH + 92);
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.roundRect(barAreaX, mapH + 100, barAreaW, 18, 4);
    ctx.fill();
    ctx.fillStyle = "#d97706";
    ctx.beginPath();
    ctx.roundRect(barAreaX, mapH + 100, barAreaW * (meanHold / maxBar), 18, 4);
    ctx.fill();

    const stateNames = CFG.trafficModel.stateNames;
    $("simClock").textContent = `Day ${state.dayIndex} | ${formatMinutesToHhmm(tNow)}`;
    $("timeScrubber").value = Math.round(tNow);
    $("scrubberLabel").textContent = formatMinutesToHhmm(tNow);
    $("trafficBadge").textContent = `CM01: ${stateNames[st01]} | CM03: ${stateNames[st03]}`;
    $("outTodayMade").textContent = `${madeSoFar}`;
    $("outTodayMissed").textContent = `${missedSoFar}`;
    $("outActive").textContent = `${activeBusesCount} buses / ${walkingPaxCount} pax`;

    if (state.missAllHistory.length > 0) {
      const mAll = computeMeanAndCi(state.missAllHistory);
      const mA = computeMeanAndCi(state.missAHistory);
      const mB = computeMeanAndCi(state.missBHistory);
      const obj = computeMeanAndCi(state.objHistory);

      $("outMissAll").textContent = `${mAll.mean.toFixed(1)}% +/- ${mAll.ci.toFixed(1)}%`;
      $("outMissAB").textContent = `A: ${mA.mean.toFixed(1)}% | B: ${mB.mean.toFixed(1)}%`;
      $("outObjJ").textContent = `${obj.mean.toFixed(0)} +/- ${obj.ci.toFixed(0)}`;
    } else if (day) {
      $("outMissAll").textContent = `${day.missRateAllPct.toFixed(1)}% (Day 1)`;
      $("outMissAB").textContent = `A: ${day.missRateAPct.toFixed(1)}% | B: ${day.missRateBPct.toFixed(1)}%`;
      $("outObjJ").textContent = `${day.objectiveJ.toFixed(0)} (Day 1)`;
    }
  }

  function populateDayTables() {
    const day = state.currentDay;
    if (!day) return;

    const tbody = $("scheduleTableBody");
    tbody.innerHTML = "";
    const conns = day.buses.filter((b) => b.legKey === "CM01_MAK_to_FOR" || b.legKey === "CM03_MAK_to_KAD")
      .sort((a, b) => a.borellaSchedMin - b.borellaSchedMin);

    for (const c of conns) {
      const tr = document.createElement("tr");
      const delay = c.borellaArrMin - c.borellaSchedMin;
      tr.innerHTML = `
        <td><strong>${c.tripId}</strong></td>
        <td>${formatMinutesToHhmm(c.borellaSchedMin)}</td>
        <td>${formatMinutesToHhmm(c.borellaArrMin)} (${delay >= 0 ? "+" : ""}${delay.toFixed(1)}m)</td>
        <td>${formatMinutesToHhmm(c.borellaActualDepMin)}</td>
        <td>${c.borellaHoldMin > 0.05 ? c.borellaHoldMin.toFixed(1) + " min" : "-"}</td>
        <td>${c.borellaOnboardPax} / ${readUIParams().capacityPax}</td>
      `;
      tbody.appendChild(tr);
    }

    const logList = $("eventLogList");
    logList.innerHTML = "";
    for (const ev of day.transferEvents) {
      const li = document.createElement("li");
      const statusText = ev.madeCount === ev.paxCount
        ? `MADE ${ev.boardedConnId} (${ev.paxCount} pax)`
        : `MISSED ${ev.targetConnId} (made ${ev.madeCount}, timing ${ev.missedTimingCount}, cap ${ev.missedCapCount})`;
      li.textContent = `[${formatMinutesToHhmm(ev.readyMin)}] ${ev.feederId} -> ${statusText}`;
      logList.appendChild(li);
    }
  }

  function recordCompletedDay() {
    const d = state.currentDay;
    state.missAllHistory.push(d.missRateAllPct);
    state.missAHistory.push(d.missRateAPct);
    state.missBHistory.push(d.missRateBPct);
    state.objHistory.push(d.objectiveJ);
    state.waitCostHistory.push(d.waitCostTotal);
    state.holdCostHistory.push(d.holdCostTotal);
    const stats = computeMeanAndCi(state.missAllHistory);
    state.convergenceTrace.push({ day: state.dayIndex, mean: stats.mean, ci: stats.ci });
  }

  function animationTick() {
    const params = readUIParams();
    state.simClockMin += 1.4 * params.animSpeed;

    if (state.simClockMin >= CFG.timeWindow.dayEndMin) {
      recordCompletedDay();
      if (state.dayIndex >= params.repTotal) {
        renderCanvasAndTables();
        pauseSimulation();
        $("startBtn").textContent = "Completed";
        $("startBtn").disabled = true;
        return;
      }
      state.dayIndex += 1;
      state.simClockMin = CFG.timeWindow.dayStartMin;
      state.currentDay = simulateFullDay(params, state.rng);
      populateDayTables();
    }

    renderCanvasAndTables();
    state.animId = requestAnimationFrame(animationTick);
  }

  function startSimulation() {
    state.running = true;
    $("startBtn").textContent = "Pause";
    state.animId = requestAnimationFrame(animationTick);
  }

  function pauseSimulation() {
    state.running = false;
    if (state.animId) cancelAnimationFrame(state.animId);
    $("startBtn").textContent = "Start";
  }

  function stepNextDayInstant() {
    const params = readUIParams();
    recordCompletedDay();
    if (state.dayIndex < params.repTotal) {
      state.dayIndex += 1;
      state.simClockMin = 510;
      state.currentDay = simulateFullDay(params, state.rng);
      populateDayTables();
    }
    renderCanvasAndTables();
  }

  function runAllReplicationsInstant() {
    pauseSimulation();
    const params = readUIParams();
    while (state.missAllHistory.length < params.repTotal) {
      recordCompletedDay();
      if (state.missAllHistory.length < params.repTotal) {
        state.dayIndex += 1;
        state.currentDay = simulateFullDay(params, state.rng);
      }
    }
    state.simClockMin = 525;
    populateDayTables();
    renderCanvasAndTables();
    $("startBtn").textContent = "Completed";
    $("startBtn").disabled = true;
  }

  function resetSimulation() {
    pauseSimulation();
    const params = readUIParams();
    state.rng = createSeededRng(params.seed);
    state.dayIndex = 1;
    state.simClockMin = 450;
    state.missAllHistory = [];
    state.missAHistory = [];
    state.missBHistory = [];
    state.objHistory = [];
    state.waitCostHistory = [];
    state.holdCostHistory = [];
    state.convergenceTrace = [];
    state.currentDay = simulateFullDay(params, state.rng);
    $("startBtn").disabled = false;
    $("startBtn").textContent = "Start";
    populateDayTables();
    renderCanvasAndTables();
  }

  $("startBtn").addEventListener("click", () => (state.running ? pauseSimulation() : startSimulation()));
  $("resetBtn").addEventListener("click", resetSimulation);
  $("nextDayBtn").addEventListener("click", stepNextDayInstant);
  $("batchRunBtn").addEventListener("click", runAllReplicationsInstant);

  $("timeScrubber").addEventListener("input", (e) => {
    state.simClockMin = parseFloat(e.target.value);
    renderCanvasAndTables();
  });

  ["holdMax", "shiftMin", "walkTime", "capacityPax", "peakSpeed", "repTotal"].forEach((id) => {
    $(id).addEventListener("input", () => {
      updateControlReadouts();
      resetSimulation();
    });
  });

  $("animSpeed").addEventListener("input", updateControlReadouts);
  ["policy", "shiftRoute", "seed"].forEach((id) => $(id).addEventListener("change", resetSimulation));

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const preset = btn.dataset.preset;
      if (preset === "baseline") {
        $("policy").value = "none";
        $("holdMax").value = "0.0";
        $("shiftMin").value = "0";
      } else if (preset === "hold3") {
        $("policy").value = "schedule";
        $("holdMax").value = "3.0";
        $("shiftMin").value = "0";
      } else if (preset === "realtime") {
        $("policy").value = "realtime";
        $("holdMax").value = "3.0";
        $("shiftRoute").value = "CM03";
        $("shiftMin").value = "-15";
      }
      updateControlReadouts();
      resetSimulation();
    });
  });

  updateControlReadouts();
  resetSimulation();
})();

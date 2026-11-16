(function () {
  "use strict";

  const CFG = window.SIM_CONFIG;
  const $ = (id) => document.getElementById(id);

  function readCssVar(name, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

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

  function sampleStandardNormalBoxMuller(rng) {
    const u1 = Math.max(1e-12, 1.0 - rng());
    const u2 = rng();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
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
      if (legKey === "CM01_MAK_to_FOR" || legKey === "CM01_FOR_to_MAK") {
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

  function generateStopArrivals(legCfg, firstOriginMin, rng) {
    const nStops = legCfg.stops.length;
    const queues = Array.from({ length: nStops }, () => []);
    const { dayStartMin, dayEndMin, preDepartureAccumMin } = CFG.timeWindow;
    const startWindowMin = Math.max(dayStartMin, firstOriginMin - (preDepartureAccumMin || 30));
    for (let s = 0; s < nStops - 1; s++) {
      const baseRate = legCfg.baseArrivalRatePaxPerMin[s];
      if (baseRate <= 0) continue;
      let t = startWindowMin;
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

  function simulateLegDay(legKey, shiftMin, trafficStates, rng, capacityPax, alphaOverride) {
    const legCfg = CFG.routes[legKey];
    const schedTrips = buildScheduledLegTrips(legKey, shiftMin);
    const firstOriginMin = schedTrips[0].originSchedMin;
    const queues = generateStopArrivals(legCfg, firstOriginMin, rng);
    const cursors = new Array(legCfg.stops.length).fill(0);
    const alpha = alphaOverride !== undefined ? alphaOverride : (state.legSpeedAlphas[legKey] || 0.9);
    const { doorTimeSec, alightTimeSec, boardTimeSec, etaNoiseSdMin } = CFG.busParameters;
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
        role: legCfg.role,
        originName: legCfg.stops[0],
        destName: legCfg.stops[legCfg.stops.length - 1],
        tripId: trip.tripId,
        originSchedMin: trip.originSchedMin,
        borellaSchedMin: trip.borellaSchedMin,
        borellaArrMin,
        borellaDwellMin,
        borellaBaseDepMin: Math.max(trip.borellaSchedMin, borellaArrMin + borellaDwellMin),
        borellaActualDepMin: Math.max(trip.borellaSchedMin, borellaArrMin + borellaDwellMin),
        borellaHoldMin: 0,
        borellaOnboardPax,
        leftBehindTotal,
        transferPaxCount: samplePoissonKnuth(CFG.busParameters.transferMeanPax, rng),
        etaErrMin: (etaNoiseSdMin || 1.0) * sampleStandardNormalBoxMuller(rng),
        targetConnectorId: null,
        stopTimeline
      };
    });
  }

  function calibrateLegAlphas(seed, peakSpeedKmph, capacityPax) {
    const pOff = calibrateJamParamBisection(CFG.trafficModel.targetSpeedOffpeakKmph);
    const pPeak = calibrateJamParamBisection(peakSpeedKmph);
    const matOff = buildParametricTransitionMatrix(pOff);
    const matPeak = buildParametricTransitionMatrix(pPeak);
    const nCalDays = 12;
    const alphas = {};

    for (const legKey of Object.keys(CFG.routes)) {
      let low = 0.25;
      let high = 2.50;
      for (let iter = 0; iter < 16; iter++) {
        const mid = 0.5 * (low + high);
        let delaySum = 0.0;
        let tripCount = 0;
        for (let d = 0; d < nCalDays; d++) {
          const calRng = createSeededRng(seed + 1009 * (d + 1));
          const tGrid = generateDailyTrafficGrid(calRng, matOff, matPeak);
          const trips = simulateLegDay(legKey, 0, tGrid, calRng, capacityPax, mid);
          for (const tr of trips) {
            delaySum += tr.borellaArrMin - tr.borellaSchedMin;
            tripCount++;
          }
        }
        const meanErr = delaySum / Math.max(1, tripCount);
        if (meanErr > 0.0) low = mid;
        else high = mid;
      }
      alphas[legKey] = 0.5 * (low + high);
    }
    return alphas;
  }

  function mapTargetConnectors(feeders, connectors) {
    const sortedConn = [...connectors].sort((a, b) => a.borellaSchedMin - b.borellaSchedMin);
    const map = new Map();
    for (const f of feeders) {
      const target = sortedConn.find((c) => c.borellaSchedMin >= f.borellaSchedMin - 1e-9);
      f.targetConnectorId = target ? target.tripId : null;
      map.set(f.tripId, f.targetConnectorId);
    }
    return map;
  }

  function resolveDirectionTransfers(groupLabel, feeders, connectors, params) {
    const { policy, holdMaxMin, walkTimeMin, capacityPax } = params;
    const { waitWeight, holdWeight } = CFG.objectiveWeights;
    const missedPenaltyMin = CFG.busParameters.missedLastConnectorPenaltyMin || 60.0;
    mapTargetConnectors(feeders, connectors);

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
            const etaReady = readyActual + (f.etaErrMin || 0.0);
            if (policy === "realtime" && etaReady > deadline + 1e-9) {
              continue;
            }
            if (readyActual > latestCatchableReady) {
              latestCatchableReady = readyActual;
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
          totalWaitMin += missedPenaltyMin;
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
    simClockMin: 450,
    legSpeedAlphas: {},
    lastCalKey: "",
    currentDay: null,
    hoveredBusId: null,
    selectedBusId: null,
    renderedBuses: [],
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

  function updateSliderFill(el) {
    if (!el) return;
    const min = parseFloat(el.min);
    const max = parseFloat(el.max);
    const val = parseFloat(el.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100.0 : 0.0;
    el.style.setProperty("--slider-pct", `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`);
  }

  function syncSegmentedButtons(policy, shiftRoute) {
    document.querySelectorAll("[data-policy]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.policy === policy);
    });
    document.querySelectorAll("[data-shift-route]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.shiftRoute === shiftRoute);
    });
  }

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

    const ruleDescriptions = {
      none: "Connectors depart strictly at max(T_sched, T_arr + dwell) with zero feeder holding.",
      schedule: `Holds connectors up to T_sched + ${p.holdMaxMin.toFixed(1)}m whenever any protected feeder is still approaching.`,
      realtime: `Holds up to T_sched + ${p.holdMaxMin.toFixed(1)}m only if noisy ETA confirms the feeder is catchable.`
    };
    $("policyRuleBox").textContent = ruleDescriptions[p.policy] || ruleDescriptions.schedule;
    syncSegmentedButtons(p.policy, p.shiftRoute);

    ["holdMax", "shiftMin", "walkTime", "capacityPax", "peakSpeed", "animSpeed", "repTotal", "timeScrubber"].forEach((id) => {
      updateSliderFill($(id));
    });
  }

  function updateAlphaReadout() {
    const a = state.legSpeedAlphas;
    if (!a.CM01_MAK_to_FOR) return;
    $("alphaReadout").textContent =
      `CALIBRATED ALPHA // CM01 MAK-FOR ${a.CM01_MAK_to_FOR.toFixed(3)} | CM01 FOR-MAK ${a.CM01_FOR_to_MAK.toFixed(3)} | ` +
      `CM03 MAK-KAD ${a.CM03_MAK_to_KAD.toFixed(3)} | CM03 KAD-MAK ${a.CM03_KAD_to_MAK.toFixed(3)}`;
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
          stopName: `${stop.stopName} -> ${nextStop.stopName}`
        };
      }
    }
    return null;
  }

  function drawMapBackground(tNow) {
    const mapH = 420;
    ctx.save();
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, canvas.width, mapH);

    ctx.strokeStyle = "#151519";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= canvas.width; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, mapH);
      ctx.stroke();
    }
    for (let gy = 0; gy <= mapH; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(canvas.width, gy);
      ctx.stroke();
    }

    ctx.fillStyle = "#0c1420";
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(106, 0);
    ctx.lineTo(74, 145);
    ctx.lineTo(54, 240);
    ctx.lineTo(30, 420);
    ctx.lineTo(0, 420);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(512, 260, 64, 22);
    ctx.strokeRect(512, 260, 64, 22);

    ctx.fillStyle = "#475569";
    ctx.font = "600 9.5px 'IBM Plex Mono', monospace";
    ctx.fillText("INDIAN OCEAN", 8, 225);
    ctx.fillText("DIYAWANNA", 516, 274);

    const peakActive = isPeakTime(tNow);
    ctx.fillStyle = peakActive ? "rgba(239, 68, 68, 0.14)" : "rgba(16, 185, 129, 0.12)";
    ctx.strokeStyle = peakActive ? "#ef4444" : "#10b981";
    ctx.lineWidth = 1;
    ctx.fillRect(366, 14, 210, 24);
    ctx.strokeRect(366, 14, 210, 24);
    ctx.fillStyle = peakActive ? "#fca5a5" : "#6ee7b7";
    ctx.font = "700 10px 'IBM Plex Mono', monospace";
    ctx.fillText(peakActive ? "REGIME: PEAK CONGESTION" : "REGIME: OFF-PEAK FLOW", 376, 30);

    ctx.restore();
  }

  function drawCorridorPolyline(stopNames, routeColor, trafficState) {
    const stateColors = [
      readCssVar("--state-free", "#10b981"),
      readCssVar("--state-slow", "#f59e0b"),
      readCssVar("--state-jammed", "#ef4444")
    ];
    const tracePath = () => {
      ctx.beginPath();
      stopNames.forEach((name, idx) => {
        const pt = CFG.mapCoordinates[name];
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
    };

    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";

    ctx.strokeStyle = stateColors[trafficState];
    ctx.lineWidth = 18;
    ctx.globalAlpha = 0.2;
    tracePath();
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    ctx.strokeStyle = routeColor;
    ctx.lineWidth = 10;
    tracePath();
    ctx.stroke();

    ctx.strokeStyle = "#18181b";
    ctx.lineWidth = 6;
    tracePath();
    ctx.stroke();

    ctx.strokeStyle = "rgba(250, 250, 250, 0.5)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 6]);
    tracePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTopDownBus(bus, pos, isCm01, isHold, isSelected, capacityPax) {
    const laneOffset = 6.0;
    const nx = -Math.sin(pos.angleRad) * laneOffset;
    const ny = Math.cos(pos.angleRad) * laneOffset;
    const bx = pos.x + nx;
    const by = pos.y + ny;

    state.renderedBuses.push({ tripId: bus.tripId, bx, by, bus, pos });

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(pos.angleRad);

    if (isSelected) {
      ctx.strokeStyle = "#fafafa";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-15, -8.5, 30, 17);
    }

    ctx.fillStyle = isHold
      ? readCssVar("--color-warning", "#eab308")
      : isCm01
        ? readCssVar("--route-cm01", "#38bdf8")
        : readCssVar("--route-cm03", "#a855f7");
    ctx.strokeStyle = "#09090b";
    ctx.lineWidth = 1.2;
    ctx.fillRect(-12, -5.5, 24, 11);
    ctx.strokeRect(-12, -5.5, 24, 11);

    ctx.fillStyle = "#09090b";
    ctx.fillRect(6, -3.5, 4, 7);
    ctx.restore();

    const capRatio = Math.min(1, pos.onboardPax / Math.max(1, capacityPax));
    const fillCol = capRatio >= 0.98 ? "#f43f5e" : capRatio >= 0.7 ? "#eab308" : "#22c55e";

    ctx.save();
    ctx.fillStyle = "#121214";
    ctx.strokeStyle = isSelected ? "#fafafa" : isHold ? "#eab308" : "#3f3f46";
    ctx.lineWidth = 1;
    ctx.fillRect(bx - 13, by - 22, 26, 12);
    ctx.strokeRect(bx - 13, by - 22, 26, 12);

    ctx.fillStyle = fillCol;
    ctx.fillRect(bx - 10, by - 12.5, 20 * capRatio, 2);

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 8px 'IBM Plex Mono', monospace";
    ctx.fillText(`${pos.onboardPax}`, bx - 6, by - 14);

    if (isHold) {
      ctx.fillStyle = "#eab308";
      ctx.font = "700 9px 'IBM Plex Mono', monospace";
      ctx.fillText("HOLD", bx - 12, by - 25);
    }
    ctx.restore();
  }

  function drawInspectorOverlay(day, tNow, params) {
    const ix = 16;
    const iy = 14;
    const iw = 264;
    const ih = 112;

    ctx.save();
    ctx.fillStyle = "rgba(18, 18, 20, 0.96)";
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.fillRect(ix, iy, iw, ih);
    ctx.strokeRect(ix, iy, iw, ih);

    let targetBus = null;
    let isPinned = false;
    const activeId = state.hoveredBusId || state.selectedBusId;
    if (day && activeId) {
      targetBus = day.buses.find((b) => b.tripId === activeId) || null;
      isPinned = Boolean(targetBus);
    }
    if (!targetBus && day) {
      const conns = day.buses
        .filter((b) => b.legKey === "CM01_MAK_to_FOR" || b.legKey === "CM03_MAK_to_KAD")
        .sort((a, b) => a.borellaActualDepMin - b.borellaActualDepMin);
      targetBus = conns.find((c) => c.borellaActualDepMin >= tNow - 5) || conns[0] || null;
    }

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 10px 'Space Grotesk', sans-serif";
    ctx.fillText(isPinned ? "TRIP INSPECTOR [PINNED]" : "NEXT BORELLA CONNECTOR", ix + 10, iy + 18);

    if (!targetBus) {
      ctx.fillStyle = "#71717a";
      ctx.font = "500 10px 'IBM Plex Mono', monospace";
      ctx.fillText("No active trip selected", ix + 10, iy + 48);
      ctx.restore();
      return;
    }

    const pos = getBusPositionAtTime(targetBus, tNow);
    const delayMin = targetBus.borellaArrMin - targetBus.borellaSchedMin;
    const delaySign = delayMin >= 0 ? "+" : "";
    const routeCol = targetBus.routeCode === "CM01" ? "#38bdf8" : "#a855f7";

    ctx.fillStyle = routeCol;
    ctx.fillRect(ix + 10, iy + 27, 4, 30);

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 11px 'IBM Plex Mono', monospace";
    ctx.fillText(`${targetBus.tripId} (${targetBus.role})`, ix + 20, iy + 38);

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 9.5px 'IBM Plex Mono', monospace";
    const statusLine = pos ? `${pos.status}: ${pos.stopName}` : `${targetBus.originName} -> ${targetBus.destName}`;
    ctx.fillText(statusLine.slice(0, 36), ix + 20, iy + 54);

    ctx.strokeStyle = "#27272a";
    ctx.beginPath();
    ctx.moveTo(ix + 10, iy + 65);
    ctx.lineTo(ix + iw - 10, iy + 65);
    ctx.stroke();

    ctx.fillStyle = "#d4d4d8";
    ctx.font = "600 9.5px 'IBM Plex Mono', monospace";
    ctx.fillText(`BORELLA: ${formatMinutesToHhmm(targetBus.borellaArrMin)} (${delaySign}${delayMin.toFixed(1)}m)`, ix + 10, iy + 82);
    ctx.fillText(`HOLD: ${targetBus.borellaHoldMin.toFixed(1)}m | LOAD: ${targetBus.borellaOnboardPax}/${params.capacityPax}`, ix + 10, iy + 99);

    ctx.restore();
  }

  function drawBorellaInset(day, tNow, params, activeHoldingBus) {
    const bx = 16;
    const by = 292;
    const bw = 264;
    const bh = 112;

    ctx.save();
    ctx.fillStyle = "rgba(18, 18, 20, 0.96)";
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 10px 'Space Grotesk', sans-serif";
    ctx.fillText("BORELLA INTERCHANGE ZOOM", bx + 10, by + 18);

    const stopYmba = { x: bx + 54, y: by + 44 };
    const stopSinger = { x: bx + 210, y: by + 44 };

    ctx.strokeStyle = "#52525b";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(stopYmba.x, stopYmba.y);
    ctx.lineTo(stopSinger.x, stopSinger.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#a855f7";
    ctx.fillRect(stopYmba.x - 6, stopYmba.y - 6, 12, 12);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(stopSinger.x - 6, stopSinger.y - 6, 12, 12);

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "600 9.5px 'IBM Plex Mono', monospace";
    ctx.fillText("YMBA (CM03)", bx + 18, by + 64);
    ctx.fillText("SINGER (CM01)", bx + 172, by + 64);

    if (day) {
      for (const ev of day.transferEvents) {
        if (tNow >= ev.startWalkMin && tNow < ev.readyMin) {
          const frac = (tNow - ev.startWalkMin) / Math.max(0.2, ev.readyMin - ev.startWalkMin);
          const x = ev.fromRoute === "CM03"
            ? stopYmba.x + (stopSinger.x - stopYmba.x) * frac
            : stopSinger.x + (stopYmba.x - stopSinger.x) * frac;
          ctx.fillStyle = ev.madeCount > 0 ? "#22c55e" : "#f43f5e";
          ctx.fillRect(x - 4, stopYmba.y - 4, 8, 8);
        }
      }
    }

    const barX = bx + 10;
    const barY = by + 79;
    const barW = bw - 20;
    ctx.fillStyle = "#27272a";
    ctx.fillRect(barX, barY, barW, 20);

    if (activeHoldingBus) {
      const elapsed = Math.max(0, tNow - activeHoldingBus.borellaBaseDepMin);
      const maxH = Math.max(0.5, params.holdMaxMin);
      const fillFrac = Math.min(1, elapsed / maxH);
      ctx.fillStyle = "#eab308";
      ctx.fillRect(barX, barY, barW * fillFrac, 20);
      ctx.fillStyle = "#09090b";
      ctx.font = "700 9.5px 'IBM Plex Mono', monospace";
      ctx.fillText(`HOLDING ${activeHoldingBus.tripId}: ${elapsed.toFixed(1)}/${maxH.toFixed(1)}m`, barX + 8, barY + 13);
    } else {
      ctx.fillStyle = "#d4d4d8";
      ctx.font = "600 9.5px 'IBM Plex Mono', monospace";
      ctx.fillText(`WALK: ${params.walkTimeMin.toFixed(1)}m | NO ACTIVE HOLD`, barX + 8, barY + 13);
    }
    ctx.restore();
  }

  function renderCanvasAndTables() {
    const w = canvas.width;
    const h = canvas.height;
    const mapH = 420;
    const params = readUIParams();

    state.renderedBuses = [];
    const day = state.currentDay;
    const tNow = state.simClockMin;

    drawMapBackground(tNow);

    const st01 = day ? getTrafficStateAt(day.traffic.CM01_MAK_to_FOR, tNow) : 0;
    const st03 = day ? getTrafficStateAt(day.traffic.CM03_MAK_to_KAD, tNow) : 0;

    drawCorridorPolyline(CFG.routes.CM03_MAK_to_KAD.stops, readCssVar("--route-cm03", "#a855f7"), st03);
    drawCorridorPolyline(CFG.routes.CM01_FOR_to_MAK.stops, readCssVar("--route-cm01", "#38bdf8"), st01);

    const bSinger = CFG.mapCoordinates["Borella (Singer Mega)"];
    const bYmba = CFG.mapCoordinates["Borella 02 (YMBA)"];
    ctx.strokeStyle = "#eab308";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bYmba.x, bYmba.y);
    ctx.lineTo(bSinger.x, bSinger.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const [name, pt] of Object.entries(CFG.mapCoordinates)) {
      const sz = pt.isBorella ? 12 : 8;
      ctx.fillStyle = pt.isBorella ? "#eab308" : "#121214";
      ctx.strokeStyle = pt.isBorella ? "#fafafa" : "#a1a1aa";
      ctx.lineWidth = pt.isBorella ? 2 : 1.5;
      ctx.fillRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);
      ctx.strokeRect(pt.x - sz / 2, pt.y - sz / 2, sz, sz);

      ctx.fillStyle = pt.isBorella ? "#fde047" : "#e4e4e7";
      ctx.font = pt.isBorella ? "700 10px 'Space Grotesk', sans-serif" : "600 9.5px 'IBM Plex Sans', sans-serif";
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
            ctx.font = "700 10.5px 'IBM Plex Mono', monospace";
            if (ev.madeCount > 0) {
              ctx.fillStyle = "#22c55e";
              ctx.fillText(`+${ev.madeCount} MADE`, pulsePt.x + 14, pulseY);
            }
            const mTot = ev.missedTimingCount + ev.missedCapCount;
            if (mTot > 0) {
              ctx.fillStyle = "#f43f5e";
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
          ctx.fillStyle = ev.madeCount > 0 ? "#22c55e" : "#f43f5e";
          ctx.fillRect(px - 4, py - 4, 8, 8);
        }
      }

      const focusId = state.hoveredBusId || state.selectedBusId;
      for (const bus of day.buses) {
        const pos = getBusPositionAtTime(bus, tNow);
        if (!pos) continue;
        activeBusesCount++;
        const isHold = pos.status === "HOLDING";
        if (isHold) activeHoldingBus = bus;
        drawTopDownBus(bus, pos, bus.routeCode === "CM01", isHold, bus.tripId === focusId, params.capacityPax);
      }
    }

    drawInspectorOverlay(day, tNow, params);
    drawBorellaInset(day, tNow, params, activeHoldingBus);

    ctx.fillStyle = "#121214";
    ctx.fillRect(0, mapH, w, h - mapH);
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mapH);
    ctx.lineTo(w, mapH);
    ctx.stroke();

    const plotL = 56;
    const plotR = 570;
    const plotT = mapH + 34;
    const plotB = h - 22;
    const plotW = plotR - plotL;
    const plotH = plotB - plotT;

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 11px 'Space Grotesk', sans-serif";
    ctx.fillText("CONVERGENCE: MISSED TRANSFERS (% +/- 95% CI)", 18, mapH + 20);
    ctx.strokeStyle = "#27272a";
    ctx.strokeRect(plotL, plotT, plotW, plotH);

    for (let pct = 0; pct <= 100; pct += 25) {
      const y = plotB - (pct / 100) * plotH;
      ctx.strokeStyle = "#1e1e22";
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotR, y);
      ctx.stroke();
      ctx.fillStyle = "#71717a";
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.fillText(`${pct}%`, 20, y + 3);
    }

    const targetR = params.repTotal;
    if (state.convergenceTrace.length > 1) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
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

      ctx.strokeStyle = "#38bdf8";
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

    const barAreaX = 602;
    const barAreaW = w - barAreaX - 24;
    ctx.fillStyle = "#fafafa";
    ctx.font = "700 11px 'Space Grotesk', sans-serif";
    ctx.fillText("OBJECTIVE J COST BREAKDOWN (PAX-MIN)", barAreaX, mapH + 20);

    const meanWait = state.waitCostHistory.length > 0
      ? computeMeanAndCi(state.waitCostHistory).mean
      : (day ? day.waitCostTotal : 0);
    const meanHold = state.holdCostHistory.length > 0
      ? computeMeanAndCi(state.holdCostHistory).mean
      : (day ? day.holdCostTotal : 0);
    const totalJ = meanWait + meanHold;
    const maxBar = Math.max(100, totalJ);

    ctx.fillStyle = "#d4d4d8";
    ctx.font = "600 10.5px 'IBM Plex Mono', monospace";
    ctx.fillText(`TRANSFER WAIT COST (2.0x): ${meanWait.toFixed(0)}`, barAreaX, mapH + 46);
    ctx.fillStyle = "#27272a";
    ctx.fillRect(barAreaX, mapH + 54, barAreaW, 14);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(barAreaX, mapH + 54, barAreaW * (meanWait / maxBar), 14);

    ctx.fillStyle = "#d4d4d8";
    ctx.fillText(`ON-BOARD HOLD COST (1.0x): ${meanHold.toFixed(0)}`, barAreaX, mapH + 92);
    ctx.fillStyle = "#27272a";
    ctx.fillRect(barAreaX, mapH + 100, barAreaW, 14);
    ctx.fillStyle = "#eab308";
    ctx.fillRect(barAreaX, mapH + 100, barAreaW * (meanHold / maxBar), 14);

    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(`TOTAL DAILY OBJECTIVE J: ${totalJ.toFixed(0)} pax-min`, barAreaX, mapH + 136);

    const stateNames = ["FREE", "SLOW", "JAMMED"];
    const dotColors = ["#10b981", "#f59e0b", "#ef4444"];
    $("simClock").textContent = `DAY ${state.dayIndex} | ${formatMinutesToHhmm(tNow)}`;
    $("timeScrubber").value = Math.round(tNow);
    $("scrubberLabel").textContent = formatMinutesToHhmm(tNow);
    updateSliderFill($("timeScrubber"));

    $("trafficBadgeCm01").textContent = `CM01: ${stateNames[st01]}`;
    $("dotCm01").style.background = dotColors[st01];
    $("trafficBadgeCm03").textContent = `CM03: ${stateNames[st03]}`;
    $("dotCm03").style.background = dotColors[st03];

    const settledToday = madeSoFar + missedSoFar;
    const madePctToday = settledToday > 0 ? (100.0 * madeSoFar) / settledToday : 0;
    const missPctToday = settledToday > 0 ? (100.0 * missedSoFar) / settledToday : 0;

    $("outTodayMade").textContent = `${madeSoFar}`;
    $("barTodayMade").style.width = `${madePctToday.toFixed(1)}%`;
    $("subTodayMade").textContent = `${madePctToday.toFixed(0)}% of ${settledToday} settled today`;

    $("outTodayMissed").textContent = `${missedSoFar}`;
    $("barTodayMissed").style.width = `${missPctToday.toFixed(1)}%`;
    $("subTodayMissed").textContent = `${missPctToday.toFixed(0)}% of ${settledToday} settled today`;

    $("outActive").textContent = `${activeBusesCount} buses / ${walkingPaxCount} pax`;
    $("barActive").style.width = `${Math.min(100, (activeBusesCount / 16) * 100).toFixed(1)}%`;
    $("subActive").textContent = `${walkingPaxCount} pax walking at Borella`;

    if (state.missAllHistory.length > 0) {
      const mAll = computeMeanAndCi(state.missAllHistory);
      const mA = computeMeanAndCi(state.missAHistory);
      const mB = computeMeanAndCi(state.missBHistory);
      const obj = computeMeanAndCi(state.objHistory);

      $("outMissAll").textContent = `${mAll.mean.toFixed(1)}% +/- ${mAll.ci.toFixed(1)}%`;
      $("barMissAll").style.width = `${Math.min(100, mAll.mean).toFixed(1)}%`;
      $("subMissAll").textContent = `Over ${state.missAllHistory.length} / ${params.repTotal} days`;

      $("outMissAB").textContent = `A: ${mA.mean.toFixed(1)}% | B: ${mB.mean.toFixed(1)}%`;
      $("barMissAB").style.width = `${Math.min(100, 0.5 * (mA.mean + mB.mean)).toFixed(1)}%`;
      $("subMissAB").textContent = "A: KAD-FOR | B: FOR-KAD";

      $("outObjJ").textContent = `${obj.mean.toFixed(0)} +/- ${obj.ci.toFixed(0)}`;
      $("barObjJ").style.width = `${Math.min(100, (obj.mean / 4500) * 100).toFixed(1)}%`;
      $("subObjJ").textContent = `Wait ${meanWait.toFixed(0)} | Hold ${meanHold.toFixed(0)}`;
    } else if (day) {
      $("outMissAll").textContent = `${day.missRateAllPct.toFixed(1)}% (Day 1)`;
      $("barMissAll").style.width = `${Math.min(100, day.missRateAllPct).toFixed(1)}%`;
      $("subMissAll").textContent = "Day 1 preview (click +1 Day or Run All R)";

      $("outMissAB").textContent = `A: ${day.missRateAPct.toFixed(1)}% | B: ${day.missRateBPct.toFixed(1)}%`;
      $("barMissAB").style.width = `${Math.min(100, 0.5 * (day.missRateAPct + day.missRateBPct)).toFixed(1)}%`;
      $("subMissAB").textContent = "A: KAD-FOR | B: FOR-KAD";

      $("outObjJ").textContent = `${day.objectiveJ.toFixed(0)} (Day 1)`;
      $("barObjJ").style.width = `${Math.min(100, (day.objectiveJ / 4500) * 100).toFixed(1)}%`;
      $("subObjJ").textContent = `Wait ${day.waitCostTotal.toFixed(0)} | Hold ${day.holdCostTotal.toFixed(0)}`;
    }
  }

  function populateDayTables() {
    const day = state.currentDay;
    if (!day) return;

    const tbody = $("scheduleTableBody");
    tbody.innerHTML = "";
    const conns = day.buses
      .filter((b) => b.legKey === "CM01_MAK_to_FOR" || b.legKey === "CM03_MAK_to_KAD")
      .sort((a, b) => a.borellaSchedMin - b.borellaSchedMin);

    for (const c of conns) {
      const tr = document.createElement("tr");
      if (state.selectedBusId === c.tripId) tr.classList.add("selected-row");
      const delay = c.borellaArrMin - c.borellaSchedMin;
      tr.innerHTML = `
        <td><strong>${c.tripId}</strong></td>
        <td>${formatMinutesToHhmm(c.borellaSchedMin)}</td>
        <td>${formatMinutesToHhmm(c.borellaArrMin)} (${delay >= 0 ? "+" : ""}${delay.toFixed(1)}m)</td>
        <td>${formatMinutesToHhmm(c.borellaActualDepMin)}</td>
        <td>${c.borellaHoldMin > 0.05 ? c.borellaHoldMin.toFixed(1) + "m" : "-"}</td>
        <td>${c.borellaOnboardPax}/${readUIParams().capacityPax}</td>
      `;
      tr.addEventListener("click", () => {
        pauseSimulation();
        state.selectedBusId = c.tripId;
        state.simClockMin = Math.max(270, Math.min(1350, c.borellaArrMin));
        populateDayTables();
        renderCanvasAndTables();
      });
      tbody.appendChild(tr);
    }

    const logList = $("eventLogList");
    logList.innerHTML = "";
    for (const ev of day.transferEvents) {
      const li = document.createElement("li");
      const isAllMade = ev.madeCount === ev.paxCount;
      li.className = isAllMade ? "log-made" : "log-missed";
      const statusText = isAllMade
        ? `MADE ${ev.boardedConnId} (${ev.paxCount} pax)`
        : `MISSED ${ev.targetConnId} (made ${ev.madeCount}, timing ${ev.missedTimingCount}, cap ${ev.missedCapCount})`;
      li.textContent = `[${formatMinutesToHhmm(ev.readyMin)}] ${ev.feederId} -> ${statusText}`;
      li.addEventListener("click", () => {
        pauseSimulation();
        state.selectedBusId = ev.targetConnId || ev.feederId;
        state.simClockMin = Math.max(270, Math.min(1350, ev.readyMin - 1.0));
        populateDayTables();
        renderCanvasAndTables();
      });
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
    const calKey = `${params.seed}|${params.peakSpeedKmph}|${params.capacityPax}`;
    if (state.lastCalKey !== calKey) {
      state.legSpeedAlphas = calibrateLegAlphas(params.seed, params.peakSpeedKmph, params.capacityPax);
      state.lastCalKey = calKey;
      updateAlphaReadout();
    }
    state.rng = createSeededRng(params.seed);
    state.dayIndex = 1;
    state.simClockMin = 450;
    state.selectedBusId = null;
    state.hoveredBusId = null;
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

  function hitTestBus(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    for (const item of state.renderedBuses) {
      if (Math.abs(x - item.bx) <= 18 && Math.abs(y - item.by) <= 18) {
        return item;
      }
    }
    return null;
  }

  canvas.addEventListener("mousemove", (e) => {
    const hit = hitTestBus(e.clientX, e.clientY);
    const nextHover = hit ? hit.tripId : null;
    canvas.style.cursor = hit ? "pointer" : "default";
    if (nextHover !== state.hoveredBusId) {
      state.hoveredBusId = nextHover;
      renderCanvasAndTables();
    }
  });

  canvas.addEventListener("click", (e) => {
    const hit = hitTestBus(e.clientX, e.clientY);
    state.selectedBusId = hit ? (state.selectedBusId === hit.tripId ? null : hit.tripId) : null;
    populateDayTables();
    renderCanvasAndTables();
  });

  $("startBtn").addEventListener("click", () => (state.running ? pauseSimulation() : startSimulation()));
  $("resetBtn").addEventListener("click", resetSimulation);
  $("nextDayBtn").addEventListener("click", stepNextDayInstant);
  $("batchRunBtn").addEventListener("click", runAllReplicationsInstant);

  $("timeScrubber").addEventListener("input", (e) => {
    state.simClockMin = parseFloat(e.target.value);
    renderCanvasAndTables();
  });

  document.querySelectorAll(".time-jump-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pauseSimulation();
      state.simClockMin = parseFloat(btn.dataset.jumpMin);
      renderCanvasAndTables();
    });
  });

  function clearActivePreset() {
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
  }

  document.querySelectorAll("[data-policy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearActivePreset();
      $("policy").value = btn.dataset.policy;
      updateControlReadouts();
      resetSimulation();
    });
  });

  document.querySelectorAll("[data-shift-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearActivePreset();
      $("shiftRoute").value = btn.dataset.shiftRoute;
      updateControlReadouts();
      resetSimulation();
    });
  });

  ["holdMax", "shiftMin", "walkTime", "capacityPax", "peakSpeed", "repTotal"].forEach((id) => {
    $(id).addEventListener("input", () => {
      clearActivePreset();
      updateControlReadouts();
      resetSimulation();
    });
  });

  $("animSpeed").addEventListener("input", updateControlReadouts);
  ["policy", "shiftRoute", "seed"].forEach((id) => {
    $(id).addEventListener("change", () => {
      updateControlReadouts();
      resetSimulation();
    });
  });

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
        $("holdMax").value = "6.0";
        $("shiftRoute").value = "CM01";
        $("shiftMin").value = "5";
      }
      updateControlReadouts();
      resetSimulation();
    });
  });

  updateControlReadouts();
  resetSimulation();
})();

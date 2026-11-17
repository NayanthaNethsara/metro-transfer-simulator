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

  const researchCanvas = $("researchCanvas");
  const researchCtx = researchCanvas.getContext("2d");
  let researchHover = null;

  const corridorMap = window.createCorridorMap({
    container: $("corridorMap"),
    routes: CFG.routes,
    geo: window.CORRIDOR_GEO,
    formatTime: formatMinutesToHhmm,
    isPeakTime,
    onBusHover: (tripId) => {
      if (tripId === state.hoveredBusId) return;
      state.hoveredBusId = tripId;
      renderFrame();
    },
    onBusClick: (tripId) => {
      state.selectedBusId = state.selectedBusId === tripId ? null : tripId;
      populateDayTables();
      renderFrame();
    },
    onBackgroundClick: () => {
      if (!state.selectedBusId) return;
      state.selectedBusId = null;
      populateDayTables();
      renderFrame();
    }
  });

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

  function summariseDayAt(day, tNow) {
    const summary = { activeBuses: 0, walkingPax: 0, madeSoFar: 0, missedSoFar: 0 };
    if (!day) return summary;
    for (const bus of day.buses) {
      const tl = bus.stopTimeline;
      if (tNow >= tl[0].arrMin && tNow <= tl[tl.length - 1].depMin) summary.activeBuses++;
    }
    for (const ev of day.transferEvents) {
      if (tNow >= ev.readyMin) {
        summary.madeSoFar += ev.madeCount;
        summary.missedSoFar += ev.missedTimingCount + ev.missedCapCount;
      } else if (tNow >= ev.startWalkMin) {
        summary.walkingPax += ev.paxCount;
      }
    }
    return summary;
  }

  function trafficStatesAt(day, tNow) {
    const states = {};
    for (const legKey of Object.keys(CFG.routes)) {
      states[legKey] = day ? getTrafficStateAt(day.traffic[legKey], tNow) : 0;
    }
    return states;
  }

  function resizeResearchCanvas() {
    const dpr = window.devicePixelRatio || 1;
    researchCanvas.width = Math.round(researchCanvas.clientWidth * dpr);
    researchCanvas.height = Math.round(researchCanvas.clientHeight * dpr);
    researchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function niceAxisMax(maxValue) {
    return Math.min(100, Math.max(40, Math.ceil((maxValue + 5) / 10) * 10));
  }

  function drawChartTitle(box, title, subtitle) {
    const ctx = researchCtx;
    ctx.fillStyle = readCssVar("--color-ink", "#fafafa");
    ctx.font = "600 12.5px 'Space Grotesk', sans-serif";
    ctx.fillText(title, box.x + 16, box.y + 24);
    ctx.fillStyle = readCssVar("--color-muted", "#71717a");
    ctx.font = "500 10.5px 'IBM Plex Mono', monospace";
    ctx.fillText(subtitle, box.x + 16, box.y + 40);
  }

  function drawTooltipBox(x, y, lines, bounds) {
    const ctx = researchCtx;
    ctx.font = "600 11px 'IBM Plex Mono', monospace";
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const height = lines.length * 16 + 10;
    const left = Math.min(bounds.right - width, Math.max(bounds.left, x + 12));
    const top = Math.max(bounds.top, y - height - 8);
    ctx.fillStyle = readCssVar("--color-surface-elevated", "#222226");
    ctx.strokeStyle = readCssVar("--color-border-strong", "#3f3f46");
    ctx.lineWidth = 1;
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    ctx.fillStyle = readCssVar("--color-ink", "#fafafa");
    lines.forEach((line, i) => ctx.fillText(line, left + 8, top + 18 + i * 16));
  }

  function drawConvergenceChart(box, params) {
    const ctx = researchCtx;
    const trace = state.convergenceTrace;
    const targetR = params.repTotal;
    const ink = readCssVar("--color-ink", "#fafafa");
    const muted = readCssVar("--color-muted", "#71717a");
    const grid = readCssVar("--color-border", "#27272a");
    const series = readCssVar("--route-cm01", "#1d9bd6");

    drawChartTitle(box, "Missed transfers: running mean with 95% CI", `${trace.length} of ${targetR} Monte Carlo days completed`);

    const plot = { left: box.x + 56, right: box.x + box.w - 24, top: box.y + 58, bottom: box.y + box.h - 40 };
    const plotW = plot.right - plot.left;
    const plotH = plot.bottom - plot.top;
    const yMax = niceAxisMax(trace.reduce((m, pt) => Math.max(m, pt.mean + pt.ci), 0));
    const yStep = yMax > 60 ? 20 : 10;
    const xOf = (dayNum) => plot.left + (dayNum / Math.max(1, targetR)) * plotW;
    const yOf = (pct) => plot.bottom - (Math.max(0, Math.min(yMax, pct)) / yMax) * plotH;

    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.lineWidth = 1;
    for (let pct = 0; pct <= yMax; pct += yStep) {
      const y = Math.round(yOf(pct)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.textAlign = "right";
      ctx.fillText(`${pct}%`, plot.left - 8, y + 3);
    }
    ctx.textAlign = "center";
    for (let k = 0; k <= 4; k++) {
      const dayNum = Math.round((k / 4) * targetR);
      ctx.fillText(`${dayNum}`, xOf(dayNum), plot.bottom + 16);
    }
    ctx.fillText("Days simulated (R)", plot.left + plotW / 2, plot.bottom + 32);
    ctx.textAlign = "left";

    if (trace.length < 2) {
      ctx.fillStyle = muted;
      ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
      const message = state.currentDay
        ? `Day 1 preview: ${state.currentDay.missRateAllPct.toFixed(1)}% missed. Press +1 Day or Run All R to build the estimate.`
        : "Run days to build the estimate.";
      ctx.fillText(message, plot.left + 12, plot.top + plotH / 2);
      return;
    }

    ctx.fillStyle = series;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    trace.forEach((pt, i) => (i === 0 ? ctx.moveTo(xOf(pt.day), yOf(pt.mean + pt.ci)) : ctx.lineTo(xOf(pt.day), yOf(pt.mean + pt.ci))));
    for (let i = trace.length - 1; i >= 0; i--) ctx.lineTo(xOf(trace[i].day), yOf(trace[i].mean - trace[i].ci));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = series;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    trace.forEach((pt, i) => (i === 0 ? ctx.moveTo(xOf(pt.day), yOf(pt.mean)) : ctx.lineTo(xOf(pt.day), yOf(pt.mean))));
    ctx.stroke();

    const last = trace[trace.length - 1];
    const lastX = xOf(last.day);
    const lastY = yOf(last.mean);
    ctx.fillStyle = readCssVar("--color-surface-subtle", "#18181b");
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = series;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = "700 11px 'IBM Plex Mono', monospace";
    const lastLabel = `${last.mean.toFixed(1)}% ± ${last.ci.toFixed(1)}`;
    const labelWidth = ctx.measureText(lastLabel).width;
    ctx.fillText(lastLabel, Math.min(lastX + 8, plot.right - labelWidth), lastY - 10);

    if (researchHover && researchHover.x >= plot.left && researchHover.x <= plot.right && researchHover.y >= box.y && researchHover.y <= box.y + box.h) {
      const hoveredDay = ((researchHover.x - plot.left) / plotW) * targetR;
      const nearest = trace.reduce((best, pt) => (Math.abs(pt.day - hoveredDay) < Math.abs(best.day - hoveredDay) ? pt : best), trace[0]);
      const hx = xOf(nearest.day);
      const hy = yOf(nearest.mean);
      ctx.strokeStyle = muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, plot.top);
      ctx.lineTo(Math.round(hx) + 0.5, plot.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = series;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
      ctx.fill();
      drawTooltipBox(hx, hy, [`Day ${nearest.day}`, `Mean ${nearest.mean.toFixed(2)}%`, `95% CI ± ${nearest.ci.toFixed(2)}`], {
        left: box.x + 4,
        right: box.x + box.w - 4,
        top: box.y + 4
      });
    }
  }

  function drawObjectiveBreakdown(box, day) {
    const ctx = researchCtx;
    const ink = readCssVar("--color-ink", "#fafafa");
    const inkSecondary = readCssVar("--color-ink-secondary", "#d4d4d8");
    const surface = readCssVar("--color-surface-subtle", "#18181b");
    const hasHistory = state.waitCostHistory.length > 0;
    const meanWait = hasHistory ? computeMeanAndCi(state.waitCostHistory).mean : (day ? day.waitCostTotal : 0);
    const meanHold = hasHistory ? computeMeanAndCi(state.holdCostHistory).mean : (day ? day.holdCostTotal : 0);
    const totalJ = meanWait + meanHold;
    const { waitWeight, holdWeight } = CFG.objectiveWeights;

    drawChartTitle(box, "Daily cost J (pax-min)", hasHistory ? `Mean over ${state.waitCostHistory.length} completed days` : "Day 1 preview");

    ctx.fillStyle = ink;
    ctx.font = "700 30px 'Space Grotesk', sans-serif";
    ctx.fillText(totalJ.toFixed(0), box.x + 16, box.y + 86);

    const barX = box.x + 16;
    const barW = box.w - 40;
    const barY = box.y + 104;
    const barH = 14;
    const parts = [
      { label: `Transfer wait (${waitWeight.toFixed(1)}x)`, value: meanWait, color: readCssVar("--cost-wait", "#94a3b8") },
      { label: `On-board hold (${holdWeight.toFixed(1)}x)`, value: meanHold, color: readCssVar("--color-warning", "#eab308") }
    ];
    ctx.fillStyle = readCssVar("--color-border", "#27272a");
    ctx.fillRect(barX, barY, barW, barH);
    let cursorX = barX;
    for (const part of parts) {
      const segW = totalJ > 0 ? (part.value / totalJ) * barW : 0;
      if (segW <= 0) continue;
      ctx.fillStyle = part.color;
      ctx.fillRect(cursorX, barY, segW, barH);
      cursorX += segW;
      ctx.fillStyle = surface;
      ctx.fillRect(cursorX, barY, 2, barH);
      cursorX += 2;
    }

    parts.forEach((part, i) => {
      const rowY = barY + barH + 26 + i * 22;
      ctx.fillStyle = part.color;
      ctx.fillRect(barX, rowY - 9, 10, 10);
      ctx.fillStyle = inkSecondary;
      ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
      ctx.fillText(part.label, barX + 18, rowY);
      ctx.fillStyle = ink;
      ctx.font = "600 11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "right";
      const share = totalJ > 0 ? (100 * part.value) / totalJ : 0;
      ctx.fillText(`${part.value.toFixed(0)}  (${share.toFixed(0)}%)`, barX + barW, rowY);
      ctx.textAlign = "left";
    });
  }

  function drawResearchPanel(day, params) {
    const w = researchCanvas.clientWidth;
    const h = researchCanvas.clientHeight;
    researchCtx.fillStyle = readCssVar("--color-surface-subtle", "#18181b");
    researchCtx.fillRect(0, 0, w, h);
    const isStacked = w < 720;
    const splitX = Math.round(w * 0.64);
    const chartBox = isStacked ? { x: 0, y: 0, w, h: h - 190 } : { x: 0, y: 0, w: splitX, h };
    const costBox = isStacked ? { x: 0, y: h - 190, w, h: 190 } : { x: splitX, y: 0, w: w - splitX, h };
    drawConvergenceChart(chartBox, params);
    researchCtx.strokeStyle = readCssVar("--color-border", "#27272a");
    researchCtx.lineWidth = 1;
    researchCtx.beginPath();
    if (isStacked) {
      researchCtx.moveTo(16, costBox.y + 0.5);
      researchCtx.lineTo(w - 16, costBox.y + 0.5);
    } else {
      researchCtx.moveTo(splitX + 0.5, 16);
      researchCtx.lineTo(splitX + 0.5, h - 16);
    }
    researchCtx.stroke();
    drawObjectiveBreakdown(costBox, day);
  }

  function renderFrame() {
    const params = readUIParams();
    const day = state.currentDay;
    const tNow = state.simClockMin;
    const trafficStateByLeg = trafficStatesAt(day, tNow);

    corridorMap.render({ day, tNow, params, focusId: state.hoveredBusId || state.selectedBusId, trafficStateByLeg });
    drawResearchPanel(day, params);

    const { activeBuses, walkingPax, madeSoFar, missedSoFar } = summariseDayAt(day, tNow);
    const stateNames = ["FREE", "SLOW", "JAMMED"];
    const dotColors = [
      readCssVar("--state-free", "#0f9d6e"),
      readCssVar("--state-slow", "#d6a10a"),
      readCssVar("--state-jammed", "#e5484d")
    ];
    const st01 = trafficStateByLeg.CM01_MAK_to_FOR;
    const st03 = trafficStateByLeg.CM03_MAK_to_KAD;
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

    $("outActive").textContent = `${activeBuses} buses / ${walkingPax} pax`;
    $("barActive").style.width = `${Math.min(100, (activeBuses / 16) * 100).toFixed(1)}%`;
    $("subActive").textContent = `${walkingPax} pax walking at Borella`;

    if (state.missAllHistory.length > 0) {
      const mAll = computeMeanAndCi(state.missAllHistory);
      const mA = computeMeanAndCi(state.missAHistory);
      const mB = computeMeanAndCi(state.missBHistory);
      const obj = computeMeanAndCi(state.objHistory);
      const meanWait = computeMeanAndCi(state.waitCostHistory).mean;
      const meanHold = computeMeanAndCi(state.holdCostHistory).mean;

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
        renderFrame();
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
        renderFrame();
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
        renderFrame();
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

    renderFrame();
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
    renderFrame();
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
    renderFrame();
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
    renderFrame();
  }

  function redrawResearchPanelOnly() {
    drawResearchPanel(state.currentDay, readUIParams());
  }

  researchCanvas.addEventListener("mousemove", (e) => {
    researchHover = { x: e.offsetX, y: e.offsetY };
    redrawResearchPanelOnly();
  });

  researchCanvas.addEventListener("mouseleave", () => {
    researchHover = null;
    redrawResearchPanelOnly();
  });

  new ResizeObserver(() => {
    resizeResearchCanvas();
    redrawResearchPanelOnly();
  }).observe(researchCanvas);

  $("startBtn").addEventListener("click", () => (state.running ? pauseSimulation() : startSimulation()));
  $("resetBtn").addEventListener("click", resetSimulation);
  $("nextDayBtn").addEventListener("click", stepNextDayInstant);
  $("batchRunBtn").addEventListener("click", runAllReplicationsInstant);

  $("timeScrubber").addEventListener("input", (e) => {
    state.simClockMin = parseFloat(e.target.value);
    renderFrame();
  });

  document.querySelectorAll(".time-jump-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pauseSimulation();
      state.simClockMin = parseFloat(btn.dataset.jumpMin);
      renderFrame();
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

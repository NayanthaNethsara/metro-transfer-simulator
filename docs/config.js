window.SIM_CONFIG = {
  seed: 42,
  defaultReplications: 100,

  timeWindow: {
    dayStartMin: 240,
    dayEndMin: 1440,
    preDepartureAccumMin: 30,
    trafficStepMin: 5,
    peakWindowsMin: [
      [360, 540],
      [1020, 1200]
    ]
  },

  demand: {
    peakMultiplier: 1.35,
    offpeakMultiplier: 0.85
  },

  busParameters: {
    capacityPax: 80,
    doorTimeSec: 12.0,
    boardTimeSec: 3.0,
    alightTimeSec: 2.0,
    transferMeanPax: 5.0,
    walkTimeMin: 3.5,
    passengerPatienceMin: 60.0,
    ticketValidityMin: 120.0,
    alternativeTravelPenaltyMin: 60.0,
    etaNoiseSdMin: 1.0
  },

  objectiveWeights: {
    waitWeight: 2.0,
    holdWeight: 1.0
  },

  trafficModel: {
    stateNames: ["Free", "Slow", "Jammed"],
    stateSpeedsKmph: [36.0, 20.0, 10.0],
    jamParamBounds: [0.01, 0.85],
    targetSpeedOffpeakKmph: 29.37,
    targetSpeedPeakKmph: 24.10
  },

  notebookReference: {
    description: "Notebook consolidated policy comparison (seed = 42, R = 1000 CRN days, LMT-GO timetable of 19 Nov 2026, w = 3.5 min, C = 80, cmb_traffic speeds, OSRM road distances)",
    tolerancePp: 2.0,
    minDaysForCheck: 300,
    calibratedAlphas: {
      CM01_MAK_to_FOR: 0.698,
      CM01_FOR_to_MAK: 0.806,
      CM03_MAK_to_KAD: 0.637,
      CM03_KAD_to_MAK: 0.654
    },
    scenarios: [
      {
        label: "Baseline",
        policy: "none",
        holdMaxMin: 0.0,
        shiftRoute: "CM01",
        shiftMin: 0,
        missAllPct: 25.57,
        missAllCi95: 0.48,
        missAPct: 27.65,
        missBPct: 23.87,
        objectiveJ: 14807.1,
        objectiveJCi95: 102.7
      },
      {
        label: "Hold only, schedule h = 5 min",
        policy: "schedule",
        holdMaxMin: 5.0,
        shiftRoute: "CM01",
        shiftMin: 0,
        missAllPct: 16.99,
        missAllCi95: 0.43,
        missAPct: 20.69,
        missBPct: 14.00,
        objectiveJ: 14213.0,
        objectiveJCi95: 103.3
      },
      {
        label: "Recommended: real-time hold h = 5 min, current timetable",
        policy: "realtime",
        holdMaxMin: 5.0,
        shiftRoute: "CM01",
        shiftMin: 0,
        missAllPct: 17.48,
        missAllCi95: 0.44,
        missAPct: 21.20,
        missBPct: 14.47,
        objectiveJ: 13425.6,
        objectiveJCi95: 100.5
      },
      {
        label: "Best shift alone, CM01 -5 min",
        policy: "none",
        holdMaxMin: 0.0,
        shiftRoute: "CM01",
        shiftMin: -5,
        missAllPct: 25.80,
        missAllCi95: 0.48,
        missAPct: 34.08,
        missBPct: 19.10,
        objectiveJ: 14431.8,
        objectiveJCi95: 96.5
      }
    ]
  },

  routes: {
    CM01_MAK_to_FOR: {
      code: "CM01",
      label: "CM01: Makumbura to Pettah",
      role: "Group A Connector",
      borellaStopIndex: 3,
      scheduledRunMin: 75,
      segmentDistancesKm: [11.45, 2.76, 1.95, 1.88, 3.11, 0.51],
      baseArrivalRatePaxPerMin: [0.45, 0.35, 0.30, 0.20, 0.12, 0.0, 0.0],
      stops: ["Makumbura", "Sethsiripaya", "Rajagiriya", "Borella (Singer Mega)", "Town Hall", "Colombo Fort", "Pettah"]
    },
    CM01_FOR_to_MAK: {
      code: "CM01",
      label: "CM01: Pettah to Makumbura",
      role: "Group B Feeder",
      borellaStopIndex: 2,
      scheduledRunMin: 75,
      segmentDistancesKm: [3.68, 1.85, 2.40, 2.67, 11.29],
      baseArrivalRatePaxPerMin: [0.65, 0.25, 0.20, 0.15, 0.10, 0.0],
      stops: ["Pettah", "Town Hall", "Borella (Singer Mega)", "Rajagiriya", "Sethsiripaya", "Makumbura"]
    },
    CM03_MAK_to_KAD: {
      code: "CM03",
      label: "CM03: Makumbura to Kadawatha",
      role: "Group B Connector",
      borellaStopIndex: 4,
      scheduledRunMin: 120,
      segmentDistancesKm: [5.98, 1.12, 7.20, 2.36, 0.73, 8.96, 5.78],
      baseArrivalRatePaxPerMin: [0.32, 0.20, 0.20, 0.25, 0.20, 0.15, 0.10, 0.0],
      stops: ["Makumbura", "Apeksha Hospital", "Nawinna", "Narahenpita Junction", "Borella 02 (YMBA)", "Campbell Park", "Kelaniya University", "Kadawatha"]
    },
    CM03_KAD_to_MAK: {
      code: "CM03",
      label: "CM03: Kadawatha to Makumbura",
      role: "Group A Feeder",
      borellaStopIndex: 3,
      scheduledRunMin: 120,
      segmentDistancesKm: [5.90, 8.44, 0.80, 2.35, 7.17, 1.18, 5.85],
      baseArrivalRatePaxPerMin: [0.28, 0.20, 0.20, 0.20, 0.15, 0.12, 0.10, 0.0],
      stops: ["Kadawatha", "Kelaniya University", "Campbell Park", "Borella 02 (YMBA)", "Narahenpita Junction", "Nawinna", "Apeksha Hospital", "Makumbura"]
    }
  },

  // Departure times from the LMT-GO app (accessed 2026-11-19); Borella and terminal times follow from scheduledRunMin.
  timetables: {
    CM01_MAK_to_FOR: [
      { tripId: "CM01-MAK-01", departure: "05:15" },
      { tripId: "CM01-MAK-02", departure: "05:45" },
      { tripId: "CM01-MAK-03", departure: "06:15" },
      { tripId: "CM01-MAK-04", departure: "06:30" },
      { tripId: "CM01-MAK-05", departure: "06:50" },
      { tripId: "CM01-MAK-06", departure: "07:10" },
      { tripId: "CM01-MAK-07", departure: "07:30" },
      { tripId: "CM01-MAK-08", departure: "07:50" },
      { tripId: "CM01-MAK-09", departure: "08:10" },
      { tripId: "CM01-MAK-10", departure: "08:45" },
      { tripId: "CM01-MAK-11", departure: "09:15" },
      { tripId: "CM01-MAK-12", departure: "09:45" },
      { tripId: "CM01-MAK-13", departure: "10:15" },
      { tripId: "CM01-MAK-14", departure: "10:45" },
      { tripId: "CM01-MAK-15", departure: "11:15" },
      { tripId: "CM01-MAK-16", departure: "11:45" },
      { tripId: "CM01-MAK-17", departure: "12:15" },
      { tripId: "CM01-MAK-18", departure: "12:45" },
      { tripId: "CM01-MAK-19", departure: "13:15" },
      { tripId: "CM01-MAK-20", departure: "13:45" },
      { tripId: "CM01-MAK-21", departure: "14:15" },
      { tripId: "CM01-MAK-22", departure: "14:45" },
      { tripId: "CM01-MAK-23", departure: "15:10" },
      { tripId: "CM01-MAK-24", departure: "15:30" },
      { tripId: "CM01-MAK-25", departure: "15:50" },
      { tripId: "CM01-MAK-26", departure: "16:10" },
      { tripId: "CM01-MAK-27", departure: "16:30" },
      { tripId: "CM01-MAK-28", departure: "16:50" },
      { tripId: "CM01-MAK-29", departure: "17:15" },
      { tripId: "CM01-MAK-30", departure: "17:45" },
      { tripId: "CM01-MAK-31", departure: "18:15" }
    ],
    CM01_FOR_to_MAK: [
      { tripId: "CM01-PET-01", departure: "07:00" },
      { tripId: "CM01-PET-02", departure: "07:30" },
      { tripId: "CM01-PET-03", departure: "08:00" },
      { tripId: "CM01-PET-04", departure: "08:20" },
      { tripId: "CM01-PET-05", departure: "09:00" },
      { tripId: "CM01-PET-06", departure: "09:30" },
      { tripId: "CM01-PET-07", departure: "10:00" },
      { tripId: "CM01-PET-08", departure: "10:30" },
      { tripId: "CM01-PET-09", departure: "11:00" },
      { tripId: "CM01-PET-10", departure: "11:15" },
      { tripId: "CM01-PET-11", departure: "11:30" },
      { tripId: "CM01-PET-12", departure: "11:45" },
      { tripId: "CM01-PET-13", departure: "12:30" },
      { tripId: "CM01-PET-14", departure: "13:00" },
      { tripId: "CM01-PET-15", departure: "13:30" },
      { tripId: "CM01-PET-16", departure: "14:00" },
      { tripId: "CM01-PET-17", departure: "14:30" },
      { tripId: "CM01-PET-18", departure: "15:00" },
      { tripId: "CM01-PET-19", departure: "15:30" },
      { tripId: "CM01-PET-20", departure: "16:00" },
      { tripId: "CM01-PET-21", departure: "16:15" },
      { tripId: "CM01-PET-22", departure: "16:30" },
      { tripId: "CM01-PET-23", departure: "17:00" },
      { tripId: "CM01-PET-24", departure: "17:20" },
      { tripId: "CM01-PET-25", departure: "17:40" },
      { tripId: "CM01-PET-26", departure: "18:00" },
      { tripId: "CM01-PET-27", departure: "18:30" },
      { tripId: "CM01-PET-28", departure: "18:45" },
      { tripId: "CM01-PET-29", departure: "19:10" },
      { tripId: "CM01-PET-30", departure: "19:30" },
      { tripId: "CM01-PET-31", departure: "20:00" }
    ],
    CM03_MAK_to_KAD: [
      { tripId: "CM03-MAK-01", departure: "05:30" },
      { tripId: "CM03-MAK-02", departure: "06:00" },
      { tripId: "CM03-MAK-03", departure: "06:40" },
      { tripId: "CM03-MAK-04", departure: "07:00" },
      { tripId: "CM03-MAK-05", departure: "07:40" },
      { tripId: "CM03-MAK-06", departure: "08:30" },
      { tripId: "CM03-MAK-07", departure: "09:00" },
      { tripId: "CM03-MAK-08", departure: "09:30" },
      { tripId: "CM03-MAK-09", departure: "10:00" },
      { tripId: "CM03-MAK-10", departure: "10:30" },
      { tripId: "CM03-MAK-11", departure: "11:00" },
      { tripId: "CM03-MAK-12", departure: "11:30" },
      { tripId: "CM03-MAK-13", departure: "12:00" },
      { tripId: "CM03-MAK-14", departure: "13:00" },
      { tripId: "CM03-MAK-15", departure: "13:30" },
      { tripId: "CM03-MAK-16", departure: "14:00" },
      { tripId: "CM03-MAK-17", departure: "14:30" },
      { tripId: "CM03-MAK-18", departure: "15:20" },
      { tripId: "CM03-MAK-19", departure: "16:00" },
      { tripId: "CM03-MAK-20", departure: "16:20" },
      { tripId: "CM03-MAK-21", departure: "17:00" },
      { tripId: "CM03-MAK-22", departure: "17:30" },
      { tripId: "CM03-MAK-23", departure: "18:00" },
      { tripId: "CM03-MAK-24", departure: "19:00" },
      { tripId: "CM03-MAK-25", departure: "20:00" },
      { tripId: "CM03-MAK-26", departure: "20:20" },
      { tripId: "CM03-MAK-27", departure: "20:40" }
    ],
    CM03_KAD_to_MAK: [
      { tripId: "CM03-KAD-01", departure: "05:00" },
      { tripId: "CM03-KAD-02", departure: "05:30" },
      { tripId: "CM03-KAD-03", departure: "06:00" },
      { tripId: "CM03-KAD-04", departure: "06:20" },
      { tripId: "CM03-KAD-05", departure: "06:40" },
      { tripId: "CM03-KAD-06", departure: "07:00" },
      { tripId: "CM03-KAD-07", departure: "07:20" },
      { tripId: "CM03-KAD-08", departure: "07:40" },
      { tripId: "CM03-KAD-09", departure: "08:00" },
      { tripId: "CM03-KAD-10", departure: "08:30" },
      { tripId: "CM03-KAD-11", departure: "09:10" },
      { tripId: "CM03-KAD-12", departure: "09:30" },
      { tripId: "CM03-KAD-13", departure: "10:00" },
      { tripId: "CM03-KAD-14", departure: "11:00" },
      { tripId: "CM03-KAD-15", departure: "12:00" },
      { tripId: "CM03-KAD-16", departure: "13:00" },
      { tripId: "CM03-KAD-17", departure: "13:30" },
      { tripId: "CM03-KAD-18", departure: "14:30" },
      { tripId: "CM03-KAD-19", departure: "15:00" },
      { tripId: "CM03-KAD-20", departure: "15:30" },
      { tripId: "CM03-KAD-21", departure: "16:00" },
      { tripId: "CM03-KAD-22", departure: "16:30" },
      { tripId: "CM03-KAD-23", departure: "17:00" },
      { tripId: "CM03-KAD-24", departure: "17:30" },
      { tripId: "CM03-KAD-25", departure: "18:00" },
      { tripId: "CM03-KAD-26", departure: "19:30" },
      { tripId: "CM03-KAD-27", departure: "20:30" }
    ]
  }
};

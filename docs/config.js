window.SIM_CONFIG = {
  seed: 42,
  defaultReplications: 100,

  timeWindow: {
    dayStartMin: 270,
    dayEndMin: 1350,
    trafficStepMin: 5,
    peakWindowsMin: [
      [360, 540],
      [1020, 1200]
    ]
  },

  busParameters: {
    capacityPax: 80,
    doorTimeSec: 12.0,
    boardTimeSec: 3.0,
    alightTimeSec: 2.0,
    transferMeanPax: 5.0,
    walkTimeMin: 3.5,
    borellaInterpolationFraction: 0.5
  },

  objectiveWeights: {
    waitWeight: 2.0,
    holdWeight: 1.0
  },

  trafficModel: {
    stateNames: ["Free", "Slow", "Jammed"],
    stateSpeedsKmph: [30.0, 15.0, 5.0],
    jamParamBounds: [0.01, 0.85],
    targetSpeedOffpeakKmph: 22.0,
    targetSpeedPeakKmph: 14.0,
    legSpeedAlpha: {
      CM01_MAK_to_FOR: 0.996,
      CM01_FOR_to_MAK: 1.151,
      CM03_MAK_to_KAD: 0.929,
      CM03_KAD_to_MAK: 0.779
    }
  },

  notebookReference: {
    description: "Baseline schedule holding (h = 3.0 min, shift = 0 min, w = 3.5 min, seed = 42)",
    expectedMissRatePct: 38.5,
    tolerancePct: 6.0
  },

  routes: {
    CM01_MAK_to_FOR: {
      code: "CM01",
      label: "CM01: Makumbura to Colombo Fort",
      role: "Group A Connector",
      borellaStopIndex: 3,
      segmentDistancesKm: [12.5, 4.0, 2.5, 2.5, 3.0],
      baseArrivalRatePaxPerMin: [0.65, 0.55, 0.50, 0.45, 0.25, 0.0],
      stops: ["Makumbura", "Sethsiripaya", "Rajagiriya", "Borella (Singer Mega)", "Town Hall", "Colombo Fort"]
    },
    CM01_FOR_to_MAK: {
      code: "CM01",
      label: "CM01: Colombo Fort to Makumbura",
      role: "Group B Feeder",
      borellaStopIndex: 3,
      segmentDistancesKm: [1.0, 2.5, 2.5, 2.5, 4.0, 12.5],
      baseArrivalRatePaxPerMin: [0.55, 0.65, 0.50, 0.45, 0.35, 0.20, 0.0],
      stops: ["Colombo Fort", "Pettah", "Town Hall", "Borella (Singer Mega)", "Rajagiriya", "Sethsiripaya", "Makumbura"]
    },
    CM03_MAK_to_KAD: {
      code: "CM03",
      label: "CM03: Makumbura to Kadawatha",
      role: "Group B Connector",
      borellaStopIndex: 4,
      segmentDistancesKm: [6.5, 2.5, 7.0, 3.0, 2.5, 7.5, 4.5],
      baseArrivalRatePaxPerMin: [0.60, 0.35, 0.35, 0.45, 0.45, 0.30, 0.25, 0.0],
      stops: ["Makumbura", "Apeksha Hospital", "Nawinna", "Narahenpita Junction", "Borella 02 (YMBA)", "Cambell Park", "Kelaniya University", "Kadawatha"]
    },
    CM03_KAD_to_MAK: {
      code: "CM03",
      label: "CM03: Kadawatha to Makumbura",
      role: "Group A Feeder",
      borellaStopIndex: 3,
      segmentDistancesKm: [4.5, 7.5, 2.5, 3.0, 7.0, 2.5, 6.5],
      baseArrivalRatePaxPerMin: [0.65, 0.45, 0.40, 0.45, 0.35, 0.25, 0.20, 0.0],
      stops: ["Kadawatha", "Kelaniya University", "Cambell Park", "Borella 02 (YMBA)", "Narahenpita Junction", "Nawinna", "Apeksha Hospital", "Makumbura"]
    }
  },

  mapCoordinates: {
    "Colombo Fort": { x: 105, y: 155, ldx: -36, ldy: -16 },
    "Pettah": { x: 165, y: 152, ldx: 10, ldy: -14 },
    "Town Hall": { x: 245, y: 205, ldx: -32, ldy: 20 },
    "Borella (Singer Mega)": { x: 350, y: 214, isBorella: true, ldx: -135, ldy: 16 },
    "Rajagiriya": { x: 465, y: 226, ldx: -24, ldy: -16 },
    "Sethsiripaya": { x: 590, y: 248, ldx: -26, ldy: -16 },
    "Makumbura": { x: 845, y: 365, ldx: -36, ldy: -16 },
    "Kadawatha": { x: 755, y: 38, ldx: -76, ldy: 4 },
    "Kelaniya University": { x: 545, y: 84, ldx: -118, ldy: 4 },
    "Cambell Park": { x: 368, y: 145, ldx: 14, ldy: 4 },
    "Borella 02 (YMBA)": { x: 350, y: 184, isBorella: true, ldx: -124, ldy: -6 },
    "Narahenpita Junction": { x: 344, y: 274, ldx: -136, ldy: 4 },
    "Nawinna": { x: 510, y: 345, ldx: -24, ldy: 20 },
    "Apeksha Hospital": { x: 615, y: 365, ldx: -42, ldy: 20 }
  },

  timetables: {
    CM01_MAK_to_FOR: [
      { tripId: "CM01-MAK-01", times: ["05:30", "06:22", "06:37", "07:01", "07:20"] },
      { tripId: "CM01-MAK-02", times: ["06:15", "07:07", "07:22", "07:46", "08:05"] },
      { tripId: "CM01-MAK-03", times: ["06:45", "07:37", "07:52", "08:16", "08:35"] },
      { tripId: "CM01-MAK-04", times: ["07:15", "08:07", "08:22", "08:46", "09:05"] },
      { tripId: "CM01-MAK-05", times: ["08:15", "09:07", "09:22", "09:46", "10:05"] },
      { tripId: "CM01-MAK-06", times: ["09:45", "10:37", "10:52", "11:16", "11:35"] },
      { tripId: "CM01-MAK-07", times: ["10:45", "11:37", "11:52", "12:16", "12:35"] },
      { tripId: "CM01-MAK-08", times: ["12:15", "13:07", "13:22", "13:46", "14:05"] },
      { tripId: "CM01-MAK-09", times: ["13:30", "14:22", "14:37", "15:01", "15:20"] },
      { tripId: "CM01-MAK-10", times: ["14:30", "15:22", "15:37", "16:01", "16:20"] },
      { tripId: "CM01-MAK-11", times: ["15:30", "16:22", "16:37", "17:01", "17:20"] },
      { tripId: "CM01-MAK-12", times: ["16:30", "17:22", "17:37", "18:01", "18:20"] }
    ],
    CM01_FOR_to_MAK: [
      { tripId: "CM01-FOR-01", times: ["07:30", "07:32", "07:49", "08:13", "08:28", "09:20"] },
      { tripId: "CM01-FOR-02", times: ["08:15", "08:17", "08:34", "08:58", "09:13", "10:05"] },
      { tripId: "CM01-FOR-03", times: ["08:45", "08:47", "09:04", "09:28", "09:43", "10:35"] },
      { tripId: "CM01-FOR-04", times: ["09:30", "09:32", "09:49", "10:13", "10:28", "11:20"] },
      { tripId: "CM01-FOR-05", times: ["10:30", "10:32", "10:49", "11:13", "11:28", "12:20"] },
      { tripId: "CM01-FOR-06", times: ["12:00", "12:02", "12:19", "12:43", "12:58", "13:50"] },
      { tripId: "CM01-FOR-07", times: ["13:30", "13:32", "13:49", "14:13", "14:28", "15:20"] },
      { tripId: "CM01-FOR-08", times: ["14:30", "14:32", "14:49", "15:13", "15:28", "16:20"] },
      { tripId: "CM01-FOR-09", times: ["15:30", "15:32", "15:49", "16:13", "16:28", "17:20"] },
      { tripId: "CM01-FOR-10", times: ["16:30", "16:32", "16:49", "17:13", "17:28", "18:20"] },
      { tripId: "CM01-FOR-11", times: ["17:30", "17:32", "17:49", "18:13", "18:28", "19:20"] },
      { tripId: "CM01-FOR-12", times: ["18:30", "18:32", "18:49", "19:13", "19:28", "20:20"] }
    ],
    CM03_MAK_to_KAD: [
      { tripId: "CM03-MAK-01", times: ["05:00", "05:25", "05:33", "06:05", "06:33", "07:02", "07:20"] },
      { tripId: "CM03-MAK-02", times: ["05:45", "06:10", "06:18", "06:50", "07:18", "07:47", "08:05"] },
      { tripId: "CM03-MAK-03", times: ["07:00", "07:25", "07:33", "08:05", "08:33", "09:02", "09:20"] },
      { tripId: "CM03-MAK-04", times: ["08:00", "08:25", "08:33", "09:05", "09:33", "10:02", "10:20"] },
      { tripId: "CM03-MAK-05", times: ["09:00", "09:25", "09:33", "10:05", "10:33", "11:02", "11:20"] },
      { tripId: "CM03-MAK-06", times: ["11:00", "11:25", "11:33", "12:05", "12:33", "13:02", "13:20"] },
      { tripId: "CM03-MAK-07", times: ["12:00", "12:25", "12:33", "13:05", "13:33", "14:02", "14:20"] },
      { tripId: "CM03-MAK-08", times: ["13:00", "13:25", "13:33", "14:05", "14:33", "15:02", "15:20"] },
      { tripId: "CM03-MAK-09", times: ["14:00", "14:25", "14:33", "15:05", "15:33", "16:02", "16:20"] },
      { tripId: "CM03-MAK-10", times: ["15:00", "15:25", "15:33", "16:05", "16:33", "17:02", "17:20"] },
      { tripId: "CM03-MAK-11", times: ["16:15", "16:40", "16:48", "17:20", "17:48", "18:17", "18:35"] },
      { tripId: "CM03-MAK-12", times: ["17:15", "17:40", "17:48", "18:20", "18:48", "19:17", "19:35"] }
    ],
    CM03_KAD_to_MAK: [
      { tripId: "CM03-KAD-01", times: ["07:45", "08:03", "08:32", "09:00", "09:32", "09:40", "10:05"] },
      { tripId: "CM03-KAD-02", times: ["09:45", "10:03", "10:32", "11:00", "11:32", "11:40", "12:05"] },
      { tripId: "CM03-KAD-03", times: ["10:45", "11:03", "11:32", "12:00", "12:32", "12:40", "13:05"] },
      { tripId: "CM03-KAD-04", times: ["11:45", "12:03", "12:32", "13:00", "13:32", "13:40", "14:05"] },
      { tripId: "CM03-KAD-05", times: ["13:45", "14:03", "14:32", "15:00", "15:32", "15:40", "16:05"] },
      { tripId: "CM03-KAD-06", times: ["14:45", "15:03", "15:32", "16:00", "16:32", "16:40", "17:05"] },
      { tripId: "CM03-KAD-07", times: ["15:45", "16:03", "16:32", "17:00", "17:32", "17:40", "18:05"] },
      { tripId: "CM03-KAD-08", times: ["16:45", "17:03", "17:32", "18:00", "18:32", "18:40", "19:05"] },
      { tripId: "CM03-KAD-09", times: ["17:45", "18:03", "18:32", "19:00", "19:32", "19:40", "20:05"] },
      { tripId: "CM03-KAD-10", times: ["19:15", "19:33", "20:02", "20:30", "21:02", "21:10", "21:35"] },
      { tripId: "CM03-KAD-11", times: ["19:45", "20:03", "20:32", "21:00", "21:32", "21:40", "22:05"] }
    ]
  }
};

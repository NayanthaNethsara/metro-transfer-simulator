# Google Maps Inputs

Values to collect from Google Maps to replace the placeholder distances, Borella position and walk time in the simulator.

Every value marked `(g)` is a rough guess from general Colombo geography, not a measurement. Replace each one with the real value and delete the `(g)`. Do not cite any `(g)` value as Google Maps data.

- Checked on (date): _11/17/26___
- Weekday used for "Depart at" lookups: _tuesday(weekday) on 11am___ (pick a normal weekday, not a holiday)

## 0. Borella stop check

The simulator currently assumes two different stops (CM01 at "Borella (Singer Mega)", CM03 at "Borella 02 (YMBA)"). This is unverified. Check the stop lists in the LMT-GO app or metrobus.lk.

| Route and direction | Exact Borella stop name | Location (road / landmark or Maps link) |
|---|---|---|
| CM01 Makumbura to Fort | Borella (Singer Mega) (g) | |
| CM01 Fort to Makumbura | Borella (Singer Mega) (g) | |
| CM03 Kadawatha to Makumbura | Borella 02 (YMBA) (g) | |
| CM03 Makumbura to Kadawatha | Borella 02 (YMBA) (g) | |

- Same stop for the transfer, or different stops? Different (g)
- Source: ____

If the transfer uses one shared stop, put the walk time below as the time to move within the stop (about 0-1 min).

## 1. Borella walk time

Use Google Maps walking directions between the two Borella stops.

| From | To | Walk time (min) | Walk distance (m) |
|---|---|---|---|
| Borella (Singer Mega) - CM01 stop | Borella 02 (YMBA) - CM03 stop | 3.0 (g) | 250 (g) |
| Borella 02 (YMBA) - CM03 stop | Borella (Singer Mega) - CM01 stop | 3.0 (g) | 250 (g) |

## 2. Road distances between stops

Use driving directions and drag the route so it follows the roads the bus actually uses. The last column shows what the simulator uses now: OSRM road distances between the geocoded stops (`scripts/build_corridor_geometry.py`).

### CM01 Makumbura to Colombo Fort

| From | To | Distance (km) | Model now uses (OSRM km) |
|---|---|---|---|
| Makumbura | Sethsiripaya | 13.0 (g) | 11.45 |
| Sethsiripaya | Rajagiriya | 3.5 (g) | 2.76 |
| Rajagiriya | Borella (Singer Mega) | 3.0 (g) | 1.95 |
| Borella (Singer Mega) | Town Hall | 2.5 (g) | 1.88 |
| Town Hall | Colombo Fort | 3.5 (g) | 3.50 |

### CM01 Colombo Fort to Makumbura

| From | To | Distance (km) | Model now uses (OSRM km) |
|---|---|---|---|
| Colombo Fort | Pettah | 1.0 (g) | 0.90 |
| Pettah | Town Hall | 3.0 (g) | 4.18 |
| Town Hall | Borella (Singer Mega) | 2.5 (g) | 1.85 |
| Borella (Singer Mega) | Rajagiriya | 3.0 (g) | 2.40 |
| Rajagiriya | Sethsiripaya | 3.5 (g) | 2.67 |
| Sethsiripaya | Makumbura | 13.0 (g) | 11.29 |

### CM03 Makumbura to Kadawatha

| From | To | Distance (km) | Model now uses (OSRM km) |
|---|---|---|---|
| Makumbura | Apeksha Hospital | 5.0 (g) | 5.98 |
| Apeksha Hospital | Nawinna | 1.5 (g) | 1.12 |
| Nawinna | Narahenpita Junction | 7.5 (g) | 7.20 |
| Narahenpita Junction | Borella 02 (YMBA) | 2.5 (g) | 2.36 |
| Borella 02 (YMBA) | Cambell Park | 1.0 (g) | 0.73 |
| Cambell Park | Kelaniya University | 10.0 (g) | 8.96 |
| Kelaniya University | Kadawatha | 5.0 (g) | 5.78 |

### CM03 Kadawatha to Makumbura

| From | To | Distance (km) | Model now uses (OSRM km) |
|---|---|---|---|
| Kadawatha | Kelaniya University | 5.0 (g) | 5.90 |
| Kelaniya University | Cambell Park | 10.0 (g) | 8.63 |
| Cambell Park | Borella 02 (YMBA) | 1.0 (g) | 0.80 |
| Borella 02 (YMBA) | Narahenpita Junction | 2.5 (g) | 2.35 |
| Narahenpita Junction | Nawinna | 7.5 (g) | 7.17 |
| Nawinna | Apeksha Hospital | 1.5 (g) | 1.18 |
| Apeksha Hospital | Makumbura | 5.0 (g) | 5.85 |

## 3. Typical driving time to Borella by time of day

Use driving directions with "Depart at" on the weekday above. Copy the range Google shows (for example "typically 35-55 min").

| Route leg | From | To | 07:00 | 08:30 | 12:00 | 17:30 |
|---|---|---|---|---|---|---|
| CM03 Kadawatha to Makumbura | Kadawatha | Borella 02 (YMBA) | 45-75 (g) | 50-80 (g) | 30-45 (g) | 40-65 (g) |
| CM01 Makumbura to Fort | Makumbura | Borella (Singer Mega) | 50-80 (g) | 55-90 (g) | 35-50 (g) | 45-70 (g) |
| CM03 Makumbura to Kadawatha | Makumbura | Borella 02 (YMBA) | 45-70 (g) | 50-80 (g) | 30-45 (g) | 40-65 (g) |
| CM01 Fort to Makumbura | Colombo Fort | Borella (Singer Mega) | 15-25 (g) | 20-35 (g) | 15-25 (g) | 25-45 (g) |

## 4. Operating question

When a Metro bus is running early, does it wait at intermediate stops such as Borella until its scheduled time, or does it continue straight away?

- Answer: Continues straight away (g)
- How you know (observation, driver, app, assumption): Assumption

## 5. Optional field observations at Borella

Only if you visit. Record aggregates only: no photos of people, no personal details.

| Date | Route and direction | Scheduled origin departure | Observed Borella arrival | Approx. passengers on board |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

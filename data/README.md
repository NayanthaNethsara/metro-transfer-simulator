# Data

## timetables/

Lanka Metro Transit routes CM01 (Makumbura-Pettah, via Colombo Fort) and CM03 (Makumbura-Kadawatha), copied from the LMT-GO mobile app on 19 November 2026 using the app's copy function. No values were edited.

| File | Contents |
|---|---|
| `lmt_go_departures.csv` | One row per trip: route, trip ID, origin, destination, departure time (`HH:MM`) and bus registration number. 116 trips: CM01 31 + 31, CM03 27 + 27. |
| `lmt_go_stops.csv` | The full stop sequence and stop code for each route direction (22-25 stops). |

Notes:

- **Departure times only.** The app lists departure times from the first stop, not times at intermediate stops. The notebook uses scheduled run times from metrobus.lk (accessed 19 November 2026): CM01 72 min Makumbura-Colombo Fort plus 3 min Fort-Pettah, CM03 120 min. Times at Borella are placed in proportion to road distance. The bus duties in the app (each bus alternating between terminals) are consistent with these run times, while the longer run times of an older website copy (110 and 140 min) are not.
- **Bus registration numbers** give the real fleet: 12 CM01 buses and 11 CM03 buses. Buses sometimes wait at the terminals between trips.
- **Model stops.** The notebook uses 6-8 main stops per direction (`Makumbura`, `Sethsiripaya`, `Rajagiriya`, `Borella`, `Town Hall`, `Colombo Fort`, `Pettah`; CM03: `Apeksha Hospital`, `Nawinna`, `Narahenpita Junction`, `Borella 02 (YMBA)`, `Campbell Park`, `Kelaniya University`, `Kadawatha`). Passenger demand is assumed per main stop, so the other stops are not modelled separately.
- **CM01 ends at Pettah.** Towards the city CM01 calls at Colombo Fort and terminates at Pettah; the return trip starts at Pettah and does not call at Colombo Fort.
- **Route codes** follow the LMT-GO app: CM01 = Makumbura-Pettah, CM03 = Makumbura-Kadawatha. The metrobus.lk website uses different codes and an older timetable.
- Timetables can change without notice; this is a snapshot.

### Source and licence

- LMT-GO mobile app (Lanka Metro Transit), accessed 2026-11-19. Run times: metrobus.lk, accessed 2026-11-19. Factual schedule data reproduced for non-commercial research use with attribution.

## Borella interchange

- **Two stops:** CM03 (Kadawatha-Makumbura) stops at Borella 02 (YMBA) on Baseline Road; CM01 (Makumbura-Fort) stops at Borella (Singer Mega) at Senanayake Junction. Confirmed from the route map in the LMT-GO app on 2026-11-19.
- **Walk:** about 370 m along Baseline Road via Senanayake Junction (road geometry from OpenStreetMap). The notebook uses a 3.5 min placeholder and sweeps 2.0-6.5 min in the sensitivity analysis.
- **Current operation:** Metro buses do not wait at Borella when running early (author's observation); holding is the policy this project proposes.
- **Stop positions and road distances:** geocoded with OpenStreetMap Nominatim and routed with OSRM (`scripts/build_corridor_geometry.py`). OpenStreetMap data is available under the Open Database License (ODbL).

## traffic/

Road traffic comes from the Colombo Traffic Index open dataset (`https://github.com/nuuuwan/cmb_traffic`, MIT License), which records Google Maps travel times about every 30 min for fixed routes (our own road distances and map come from OpenStreetMap, see above). We use the 12 route directions on the roads CM01 and CM03 run on: `Borella-Fort` and `Borella-Dematagoda-Kiribathgoda` (the city side of both routes), `Kottawa-Pamankada` (CM03 via Maharagama and Nawinna) and `Borella-Aturugiriya` and `Borella-Kaduwela` (CM01 via Rajagiriya and Battaramulla), each in both directions. `scripts/extract_cmb_traffic.py` summarises the 68,312 observations between 05:00 and 22:00 (9 Nov 2025 to 16 May 2026; the last three routes start on 18 Nov 2025) into the files the notebook and the web demo read:

```bash
git clone https://github.com/nuuuwan/cmb_traffic.git /tmp/cmb_traffic
python scripts/extract_cmb_traffic.py --cmb-repo /tmp/cmb_traffic --output-dir data/traffic
```

| File | Contents |
|---|---|
| `traffic_states.csv` | For each time-of-day band and traffic state: number of observations, share and mean speed. Gives the state speeds. |
| `traffic_transitions.csv` | For each band: counts of state changes between consecutive observations of the same corridor 20-40 min apart (37,471 pairs). Gives the 30-min transition matrices. |
| `traffic_hourly.csv` | Observed state shares and mean speed for each hour, used to check the simulated day (Check 2a). |
| `corridor_speeds.csv` | Peak and off-peak speed summary for each corridor. For reference only; the model does not read it. |

- **States:** an observation is free, slow or jammed when its travel-time ratio (free-flow speed / speed) is below 1.3, between 1.3 and 2.0, or at least 2.0. Free-flow speed is the 90th percentile of all of that corridor's observations, including night hours, so the busiest hours are not taken as normal.
- **Bands:** early 05:00-07:00, morning peak 07:00-09:00, midday 09:00-16:00, evening peak 16:00-19:00, evening 19:00-22:00 (Colombo time).
- **Coverage:** together the routes cover the roads of both bus routes from end to end, but not every street they use (for example Narahenpita and the last kilometres to Makumbura and Kadawatha). cmb_traffic collected fewer observations in the morning peak, so there are fewer morning pairs (584). There is no synthetic fallback; the notebook needs these files.

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

Colombo road corridor speed profiles are extracted from the Colombo Traffic Index open dataset (`https://github.com/nuuuwan/cmb_traffic`, MIT License) for the three covered sub-corridors (`Kiribathgoda-Dematagoda`, `Dematagoda-Borella`, `Fort-Borella` in both directions) using `scripts/extract_cmb_traffic.py`:

```bash
git clone https://github.com/nuuuwan/cmb_traffic.git /tmp/cmb_traffic
python scripts/extract_cmb_traffic.py --cmb-repo /tmp/cmb_traffic --output data/traffic/corridor_speeds.csv
```

If `data/traffic/corridor_speeds.csv` is not present on disk when running the notebook, the notebook automatically falls back to the clearly flagged synthetic target speed assumptions (`22.0 km/h` off-peak, `14.0 km/h` peak) anchored qualitatively to Western Province peak periods (`06:00-09:00` and `17:00-20:00`) and loading ranges reported by Amalan (2021).

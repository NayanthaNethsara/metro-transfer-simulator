# Data

## timetables/

Raw departure schedules for Lanka Metro Transit routes CM01 and CM03, copied from the LMT-GO mobile app (Lanka Metro Transit) on 10 November 2026 and converted to 24-hour `HH:MM`. Values are exactly as shown in the app; no cleaning has been applied in these CSV files.

| File | Route and direction | Trips |
|---|---|---|
| `cm01_makumbura_to_fort.csv` | CM01 Makumbura to Colombo Fort | 12 |
| `cm01_fort_to_makumbura.csv` | CM01 Colombo Fort to Makumbura | 12 |
| `cm03_makumbura_to_kadawatha.csv` | CM03 Makumbura to Kadawatha | 12 |
| `cm03_kadawatha_to_makumbura.csv` | CM03 Kadawatha to Makumbura | 11 |

Columns are timetable timepoints only. Borella is not a published timepoint and is interpolated between its bracketing timepoints inside the notebook.

### Known issues (handled in the notebook cleaning step)

- The app labels routes with codes that differ from the official route announcement. Route codes here follow the official announcement: CM01 = Makumbura-Pettah/Fort, CM03 = Makumbura-Kadawatha.
- `CM03-MAK-02` (05:45 from Makumbura) has a +60-minute offset on intermediate timepoints (`Nawinna` 07:18 through `Kelaniya University` 08:47), while the terminal arrival at `Kadawatha` (08:05) follows the standard 140-minute runtime. The notebook subtracts 60 minutes from those four columns and asserts strict monotonicity.
- Timetables are subject to operational updates without notice.

### Source and licence

- Timetables: LMT-GO mobile app (Lanka Metro Transit), accessed 2026-11-10, cross-checked against `https://metrobus.lk`. Factual schedule data reproduced for non-commercial research use with attribution.

## traffic/

Colombo road corridor speed profiles are extracted from the Colombo Traffic Index open dataset (`https://github.com/nuuuwan/cmb_traffic`, MIT License) for the three covered sub-corridors (`Kiribathgoda-Dematagoda`, `Dematagoda-Borella`, `Fort-Borella` in both directions) using `scripts/extract_cmb_traffic.py`:

```bash
git clone https://github.com/nuuuwan/cmb_traffic.git /tmp/cmb_traffic
python scripts/extract_cmb_traffic.py --cmb-repo /tmp/cmb_traffic --output data/traffic/corridor_speeds.csv
```

If `data/traffic/corridor_speeds.csv` is not present on disk when running the notebook, the notebook automatically falls back to the clearly flagged synthetic target speed assumptions (`22.0 km/h` off-peak, `14.0 km/h` peak) anchored qualitatively to Western Province peak periods (`06:00-09:00` and `17:00-20:00`) and loading ranges reported by Amalan (2021).

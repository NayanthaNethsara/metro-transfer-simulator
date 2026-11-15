# Data

## timetables/

Raw departure schedules for Lanka Metro Transit routes CM01 and CM03, copied from the LMT-GO mobile app (Lanka Metro Transit) on 10 November 2026 and converted to 24-hour `HH:MM`. Values are exactly as shown in the app; no cleaning has been applied in these files.

| File | Route and direction | Trips |
|---|---|---|
| `cm01_makumbura_to_fort.csv` | CM01 Makumbura → Colombo Fort | 12 |
| `cm01_fort_to_makumbura.csv` | CM01 Colombo Fort → Makumbura | 12 |
| `cm03_makumbura_to_kadawatha.csv` | CM03 Makumbura → Kadawatha | 12 |
| `cm03_kadawatha_to_makumbura.csv` | CM03 Kadawatha → Makumbura | 11 |

Columns are timetable timepoints only. Borella is not a timepoint and must be interpolated.

### Known issues (handled in the notebook's data-cleaning step)

- The app labels the routes with codes that differ from the official route announcement. Route codes here follow the official announcement: CM01 = Makumbura–Pettah/Fort, CM03 = Makumbura–Kadawatha.
- `CM03-MAK-02` (05:45 from Makumbura) has inconsistent times: Nawinna 07:18 is 68 min after Apeksha Hospital (other trips: 8 min), and Kadawatha 08:05 is earlier than Kelaniya University 08:47.
- The app states that timetables can change without notice.

### Source and licence

Timetables: LMT-GO mobile app (Lanka Metro Transit), accessed 2026-11-10. Factual schedule data reproduced for non-commercial research use with attribution.

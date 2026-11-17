# User guide: Metro Transfer Simulator web demo

**Open the demo:** [https://nayanthanethsara.github.io/metro-transfer-simulator/](https://nayanthanethsara.github.io/metro-transfer-simulator/), or double-click `docs/index.html` in a modern browser (Chrome, Edge, or Firefox). Everything runs client-side with zero external servers or uploads.

![Labelled screenshot of the demo](figures/demo-screenshot-labelled.png)

## Controls

| Control | What it does | Range | Default |
|---|---|---|---|
| 01. Scenario Presets | Loads `01. BASELINE` (`none`, `h=0`), `02. HOLD 3M` (`schedule`, `h=3`), or `03. RT + SHIFT` (`realtime`, `h=6`, CM01 `+5 min`) | 3 presets | `02. HOLD 3M` |
| Borella holding rule | Segmented toggle for `NONE`, `SCHEDULE` (hold up to `T_sched + h`), or `REAL-TIME` (skip uncatchable holds via ETA) | 3 modes | `SCHEDULE` |
| Max hold time `h` | Maximum Borella holding allowance past scheduled departure | `0.0` to `6.0 min` (step `0.5`) | `3.0 min` |
| Timetable shift route | Segmented toggle choosing `CM03 (KAD-MAK)` or `CM01 (FOR-MAK)` | 2 routes | `CM03` |
| Schedule shift `Delta` | Uniformly shifts all departures of the selected route (both directions) | `-30` to `+30 min` (step `5`) | `0 min` |
| Borella walk time `w` | Walking time between `Borella 02 (YMBA)` and `Borella (Singer Mega)` | `1.0` to `6.0 min` (step `0.5`) | `3.5 min` |
| Bus capacity `C` | Maximum passenger load per bus before local/transfer boarding spills to the next trip | `40` to `120 pax` (step `10`) | `80 pax` |
| Peak target car speed | Target car speed used to calibrate the peak-hour traffic Markov matrix | `16` to `32 km/h` (step `1`) | `24 km/h` |
| Playback speed | Animation speed multiplier for the daily transit map | `0.5x` to `10.0x` | `2.5x` |
| Monte Carlo days `R` | Total number of independent simulated days in the ensemble | `20` to `500 days` | `100 days` |
| Random seed | Integer seed for deterministic reproducible runs | `>= 1` | `42` |
| Day Clock Scrubber & Quick Jumps | Scrubs `04:30` to `22:30` or jumps directly to `08:00 AM PEAK`, `09:16 TIGHT B`, `14:46 TIGHT A`, or `17:46 PM PEAK` | `04:30` to `22:30` | `07:30` |
| Start / Pause | Starts or pauses the animated day-by-day Monte Carlo run | - | - |
| Run All R | Runs all remaining replications instantaneously to display converged 95% CIs | - | - |
| +1 Day | Advances immediately by one simulated day and updates running CIs | - | - |
| Reset | Re-initializes the RNG seed, re-calibrates per-leg speed factors if needed, and resets Day 1 | - | - |

## Reading the outputs

- **Colombo Street Map:** A real street map (Leaflet with Esri basemap tiles, no API key) showing the CM01 (blue) and CM03 (purple) corridors along their actual roads. Stop locations come from OpenStreetMap and road paths from the OSRM router, generated once by `scripts/build_corridor_geometry.py` into `docs/corridor-geo.js`; they are for display only and the simulator still uses the segment distances in `docs/config.js`. Each direction is drawn as its own left-hand lane coloured and patterned by its current traffic state (`Free` solid green, `Slow` dashed amber, `Jammed` dotted red). Bus markers point in their direction of travel, carry a load bar (green, amber above 70%, red when full), and pulse amber while a connector is holding at Borella. Use the layers button (top right) to switch between Dark, Light and Satellite basemaps.
- **Map overlays:** The top-left **Trip Inspector** shows the next Borella connector, or any bus you hover or click (click again or click the map to unpin). The top-right panel shows the clock, the peak/off-peak regime and the traffic state of all four directions. The bottom-left **Borella Interchange** inset zooms into the two Borella stops and the OpenStreetMap walking path between them, with walking transfer groups (green = connection made, red = missed, number = passengers), the holding countdown bar and the most recent transfer outcomes.
- **Research Panel:** The convergence chart plots the running Monte Carlo mean missed transfer rate (%) with its shaded 95% confidence band as days advance toward `R` (hover for exact values). The cost panel splits the daily objective `J` into `Transfer wait (2.0x)` and `On-board hold (1.0x)` passenger-minutes.
- **KPI Cards & Interactive Tables:** Six telemetry cards show today's made/missed counts with progress bars, network activity, running `Mean Missed (95% CI)`, `Group A vs Group B Miss`, and `Objective J`. Clicking any row in the **Borella Connector Departures & Holds** table or any event in the **Borella Feeder Transfer Log** pauses the clock, jumps directly to that timestamp, and pins that bus in the Trip Inspector.

## Try this

1. Click **01. BASELINE**, click **Run All R**, and notice the baseline missed transfer rate across Groups A and B.
2. Click **02. HOLD 3M**, click **14:46 TIGHT A** in the quick-jump bar, and watch `CM01-MAK-09` enter `HOLD` at Borella in the Zoom inset while rescuing Group A passengers from `CM03-KAD-05`.
3. Click **03. RT + SHIFT** and **Run All R** to observe how shifting CM01 schedules by `+5 min` together with real-time ETA holding (`h = 6.0 min`) cuts Group A missed connections while avoiding futile holds and lowering total Objective `J`.

## Check against the notebook

Both the browser simulator (`docs/script.js`) and `notebook/metro-transfer-simulator.ipynb` share the exact cleaned timetables, dwell formula, 3-state Markov traffic calibration, per-leg speed factor bisection (`alpha`), target connector mapping ($T_{c,\text{sched}} \ge T_{f,\text{sched}}$), and objective weights ($w_{\text{wait}}=2.0, w_{\text{hold}}=1.0$). Notice that the JavaScript engine uses a deterministic 32-bit PRNG (`mulberry32`) whereas Python uses NumPy PCG64 via `SeedSequence`, so individual day trajectories differ while ensemble Monte Carlo means agree within the stated 95% confidence intervals (locked `R = 1000` Python reference values in `docs/config.js` calibrated to `cmb_traffic`: Baseline `19.94 +/- 0.61%` / `J = 7577.5`, Hold-only real-time `h = 3.0m` `18.47 +/- 0.61%` / `J = 7401.6`, Joint real-time `h = 6.0m, CM01 +5m` `14.33 +/- 0.53%` / `J = 7167.7`).

## Limitations

- The browser demo uses the same placeholder segment distances and synthetic stop arrival rates as the notebook until field measurements are substituted in `docs/config.js`.
- Maximum replications in the interactive UI are capped at `500` days to keep browser interactions instantaneous (versus `1000-2000` replications in the Colab notebook).

# Metro Transfer Simulator

Discrete-event simulation of Lanka Metro Transit bus transfers at Borella, Colombo (routes CM01 and CM03), evaluating holding rules and timetable coordination for a two-way Kadawatha-Pettah through-ticket.

**[Live Demo (GitHub Pages)](https://nayanthanethsara.github.io/metro-transfer-simulator/)**

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/nayanthanethsara/metro-transfer-simulator/blob/main/notebook/metro-transfer-simulator.ipynb)

![Screenshot of the web demo](figures/demo-screenshot.png)

## The problem

Lanka Metro Transit operates fixed-schedule, digitally ticketed Metro buses along Route CM01 (Makumbura to Colombo Fort/Pettah) and Route CM03 (Makumbura to Kadawatha), both calling at Borella without a direct Kadawatha-Pettah route. A through-ticket with one transfer at Borella would connect both directions simultaneously:

- **Group A (Kadawatha to Pettah):** CM03 northbound/southbound approach from Kadawatha to Borella (`Borella 02 - YMBA`), transferring to CM01 towards Colombo Fort (`Borella Singer Mega`).
- **Group B (Pettah to Kadawatha):** CM01 approach from Colombo Fort/Pettah to Borella, transferring to CM03 towards Kadawatha.

Uncoordinated timetables, road traffic variability, dwell-time fluctuations, and an 80-passenger bus capacity limit make tight transfers fragile, where a missed connection often adds roughly 60 minutes of waiting. **Question:** What Borella bus-holding rule (none, schedule-based, or real-time ETA-based) and route-level timetable shift $\Delta$ minimize missed connections across both directions simultaneously without imposing excessive delay on on-board through-passengers?

## Quick start

**Interactive web demo:** Open the [live demo](https://nayanthanethsara.github.io/metro-transfer-simulator/), or clone/download this repository and double-click `docs/index.html` in any modern browser (Chrome, Edge, or Firefox).

**Google Colab notebook:** Click the Open in Colab badge above and select `Runtime -> Run all`.

**Run locally (optional):**

```bash
pip install -r requirements.txt
jupyter notebook notebook/metro-transfer-simulator.ipynb
```

**Optional empirical traffic extraction (`cmb_traffic`):**

```bash
git clone https://github.com/nuuuwan/cmb_traffic.git /tmp/cmb_traffic
python scripts/extract_cmb_traffic.py --cmb-repo /tmp/cmb_traffic --output data/traffic/corridor_speeds.csv
```

## Using the demo

Full controls, output definitions, and scenario walkthroughs: [USER_GUIDE.md](USER_GUIDE.md).

## Model and mathematics

Full derivations, Markov chain formulation, discrete-event queueing rules, assumptions, and parameter provenance: [THEORY.md](THEORY.md).

Summary of the three-layer model:
1. **Road traffic layer:** Three-state discrete-time Markov chain (`Free: 30 km/h`, `Slow: 15 km/h`, `Jammed: 5 km/h`) on $5\text{ min}$ slots with separate peak (`06:00-09:00`, `17:00-20:00`) and off-peak transition matrices calibrated via bisection.
2. **Bus journey layer:** Stop-by-stop bus progression with inverse-transform exponential passenger arrivals, uniform downstream destinations, linear dwell times $t_{\text{dwell}} = (12 + 2 a_s + 3 b_s)/60\text{ min}$, and FIFO boarding capped at $C = 80$.
3. **Borella transfer layer:** Priority-queue discrete-event simulation pairing feeders and opposite-direction connectors under `none`, `schedule`, and `realtime` (ETA-based) holding policies, minimizing daily equivalent passenger-minutes $J(h, \Delta) = w_{\text{wait}} \mathbb{E}[\sum_i W_i] + w_{\text{hold}} \mathbb{E}[\sum_b N_b \cdot \text{hold}_b]$.

## Verification

All eight verification checks (Markov stationary shares, calibrated corridor speeds and leg runtimes, zero-variance limit, closed-form Gaussian transfer probability, exact passenger conservation, $h=0$ policy equivalence, capacity invariants, and common-random-numbers variance reduction) plus $O(R^{-1/2})$ Monte Carlo error scaling are implemented with explicit `assert` statements in `notebook/metro-transfer-simulator.ipynb`.

![Verification plot](figures/verification.png)

## Concepts applied

This project applies next-event time-advance discrete-event simulation with FIFO passenger queueing, explicit inverse-transform and Knuth/Box-Muller random variate generation, discrete-time Markov chains with stationary distribution calibration, and Monte Carlo integration with common random numbers and $O(R^{-1/2})$ confidence interval scaling based on the law of large numbers.

## Results, limitations and future work

- **Summary of findings (R = 1,000 CRN days, 95% CI):**
  - **Baseline (current timetable, no holding):** `23.45 +/- 0.67%` missed connections overall (`20.23 +/- 0.95%` Group A Kadawatha-Pettah, `25.79 +/- 0.89%` Group B Pettah-Kadawatha), mean wait `43.67 +/- 0.48 min`, daily cost `J = 8273.5 +/- 108.3 pax-min`. Under the independent `E1` baseline sample (`R = 1,000`), misses decompose into `10.57%` timing misses and `13.05%` capacity misses (`23.62 +/- 0.67%` total).
  - **Hold-only at current timetable (h = 3.0 min):** Schedule holding (`J = 8282.6 +/- 109.0 pax-min`, hold cost `186.8 pax-min`) barely offsets on-board delay; real-time ETA holding avoids futile holds (`16.0` vs `186.8 pax-min` hold cost) to achieve `22.23 +/- 0.66%` missed and `J = 8128.3 +/- 106.7 pax-min`.
  - **Joint optimal coordination (CM01 shift +10 min, real-time ETA hold h = 6.0 min):** Cuts overall misses to `18.54 +/- 0.56%` (Group A drops nearly in half from `20.23%` to `12.15 +/- 0.80%`; Group B drops to `23.17 +/- 0.76%`), reduces mean wait to `41.57 +/- 0.47 min`, limits hold penalty to `50.2 pax-min` (versus `310.0 pax-min` for naive schedule holding at the same shift and `h`), and lowers daily objective cost to `J = 7940.7 +/- 104.4 pax-min`.
  - **Capacity bottleneck (E5 uncapped C = inf):** Removing the 80-passenger seat limit at the same joint optimal policy drops missed connections to `7.09 +/- 0.40%` (`7.58%` Group A, `6.72%` Group B, `J = 6784.7 +/- 73.0 pax-min`), proving that remaining peak misses stem primarily from full buses rather than schedule offset alone.
- **Main limitations:** Stop-level passenger arrival rates, transfer volumes, Borella walk time ($3.5\text{ min}$), and stop-to-stop road distances currently use flagged placeholders anchored to published Western Province bus loading profiles until direct field measurements and extracted `cmb_traffic` summaries are supplied. Corridor Markov chains currently evolve independently without shared junction correlation.

## Key references

Full IEEE reference list: [REFERENCES.md](REFERENCES.md).

- A. M. Law, *Simulation Modeling and Analysis*, 5th ed., 2015.
- T. Amalan, "Analysis of Bus Passenger Demand and Supply: Case Study on Western Province, Sri Lanka," *IJSRM*, 2021, doi: `10.18535/ijsrm/v9i11.em03`.
- R. W. Hall, M. Dessouky, and Q. Lu, "Optimal holding times at transfer stations," *Comput. Ind. Eng.*, 2001, doi: `10.1016/S0360-8352(01)00039-0`.
- N. I. Senaratna, Colombo Traffic Index (`cmb_traffic`), `https://github.com/nuuuwan/cmb_traffic`.

## AI assistance

Developed with the assistance of AI coding and writing tools. All equations, simulator logic, verification assertions, and documentation were reviewed and structured for reproducibility.

## Licence and credits

- Code: [MIT License](LICENSE).
- Schedules: LMT-GO mobile application (Lanka Metro Transit, accessed 10 Nov 2026), cross-checked against `https://metrobus.lk`.
- Open traffic schema: `github.com/nuuuwan/cmb_traffic` (MIT License).

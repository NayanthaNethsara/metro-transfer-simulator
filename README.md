# Metro Transfer Simulator

Discrete-event simulation of Lanka Metro Transit bus transfers at Borella, Colombo (routes CM01 and CM03), evaluating holding rules and timetable coordination for a two-way Kadawatha-Pettah through-ticket.

**[Live Demo (GitHub Pages)](https://nayanthanethsara.github.io/metro-transfer-simulator/)**

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/nayanthanethsara/metro-transfer-simulator/blob/main/notebook/metro-transfer-simulator.ipynb)

![Screenshot of the web demo](figures/demo-screenshot.png)

## The problem

Lanka Metro Transit operates fixed-schedule, digitally ticketed Metro buses along Route CM01 (Makumbura to Colombo Fort/Pettah) and Route CM03 (Makumbura to Kadawatha), both calling at Borella without a direct Kadawatha-Pettah route. A through-ticket with one transfer at Borella would connect both directions simultaneously:

- **Group A (Kadawatha to Pettah):** CM03 northbound/southbound approach from Kadawatha to Borella (`Borella 02 - YMBA`), transferring to CM01 towards Colombo Fort (`Borella Singer Mega`).
- **Group B (Pettah to Kadawatha):** CM01 approach from Colombo Fort/Pettah to Borella, transferring to CM03 towards Kadawatha.

The ticket is part-paid: the passenger pays part of the fare on the first bus and the balance on the connecting bus within a validity window (proposed: 2 hours). Seats are not reserved, so boarding at Borella is first come, first served, and a passenger who cannot board either waits for the next Metro bus or leaves to use other transport.

Uncoordinated timetables, road traffic variability, dwell-time fluctuations, and an 80-passenger bus capacity limit make tight transfers fragile, where a missed connection often means waiting an hour or more, or abandoning the Metro trip. **Question:** What Borella bus-holding rule (none, schedule-based, or real-time ETA-based) and route-level timetable shift $\Delta$ minimize missed connections across both directions simultaneously without imposing excessive delay on on-board through-passengers?

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
1. **Road traffic layer:** Three-state discrete-time Markov chain (`Free: 36 km/h`, `Slow: 20 km/h`, `Jammed: 10 km/h`) on $5\text{ min}$ slots with separate peak (`06:00-09:00`, `17:00-20:00`) and off-peak transition matrices calibrated via bisection to `cmb_traffic` corridor speeds (`29.37 / 24.10 km/h`).
2. **Bus journey layer:** Stop-by-stop bus progression with inverse-transform exponential passenger arrivals, uniform downstream destinations, linear dwell times $t_{\text{dwell}} = (12 + 2 a_s + 3 b_s)/60\text{ min}$, and FIFO boarding capped at $C = 80$.
3. **Borella transfer layer:** Priority-queue discrete-event simulation pairing feeders and opposite-direction connectors under `none`, `schedule`, and `realtime` (ETA-based) holding policies, with first-come-first-served boarding shared with local Borella passengers, a passenger patience limit ($P = 60\text{ min}$) and ticket validity ($V = 120\text{ min}$) after which passengers leave for other transport. Policies minimize daily equivalent passenger-minutes $J(h, \Delta) = w_{\text{wait}} \mathbb{E}[\sum_i W_i + \pi_{\text{alt}} N_{\text{oow}}] + w_{\text{hold}} \mathbb{E}[\sum_b N_b \cdot \text{hold}_b]$.

## Verification

All eight verification checks (Markov stationary shares, calibrated corridor speeds and leg runtimes, zero-variance limit, closed-form Gaussian transfer probability, exact passenger conservation, $h=0$ policy equivalence, capacity invariants, and common-random-numbers variance reduction) plus $O(R^{-1/2})$ Monte Carlo error scaling are implemented with explicit `assert` statements in `notebook/metro-transfer-simulator.ipynb`.

![Verification plot](figures/verification.png)

## Concepts applied

This project applies next-event time-advance discrete-event simulation with FIFO passenger queueing, explicit inverse-transform and Knuth/Box-Muller random variate generation, discrete-time Markov chains with stationary distribution calibration, and Monte Carlo integration with common random numbers and $O(R^{-1/2})$ confidence interval scaling based on the law of large numbers.

## Results, limitations and future work

- **Summary of findings (calibrated to `cmb_traffic`, 52,255 journeys; R = 1,000 CRN days, 95% CI):**
  - **Baseline (current timetable, no holding):** `24.70 +/- 0.64%` missed connections overall (`34.02 +/- 1.05%` Group A Kadawatha-Pettah, `17.90 +/- 0.78%` Group B Pettah-Kadawatha), and `15.11 +/- 0.54%` of through-ticket passengers give up and use other transport. Mean wait `36.92 +/- 0.37 min`, daily cost `J = 9392.5 +/- 94.4 pax-min`. In the independent `E1` sample, misses are mostly timing misses (`21.54%`) rather than full buses (`3.54%`).
  - **Hold-only at current timetable (h = 3.0 min):** Schedule holding barely changes the cost (`J = 9381.1 +/- 97.7`, hold cost `351.9 pax-min`); real-time ETA holding avoids futile holds (hold cost `33.9 pax-min`), giving `21.63 +/- 0.61%` missed and `J = 9090.2 +/- 95.1 pax-min`.
  - **Best tested policy (CM01 shift +5 min, real-time ETA hold h = 6.0 min):** Cuts overall misses to `15.36 +/- 0.54%` (Group A `17.79%`, Group B `13.58%`) and lost passengers to `8.85 +/- 0.42%`, with hold cost `120.3 pax-min` (versus `543.2` for schedule holding at the same shift and `h`) and `J = 8652.5 +/- 91.0 pax-min`. `h = 6 min` is the edge of the tested grid, so longer holds may help further.
  - **Capacity (E5 uncapped C = inf):** Removing the 80-passenger limit at the best policy only lowers misses to `12.53 +/- 0.51%`, so with first-come-first-served boarding and passenger patience most remaining misses are timing misses, not full buses.
  - **Ticket validity (E6):** 95% of boarded through-ticket passengers wait under `80 min` at Borella, and `99.8%` board within `120 min`, so the proposed 2-hour validity covers almost every transfer.
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

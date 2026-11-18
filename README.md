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

Uncoordinated timetables, road traffic variability, dwell-time fluctuations, and an 80-passenger bus capacity limit make transfers fragile: the tightest scheduled connections leave only 6-8 minutes of slack, and a missed connection often means waiting an hour or more, or abandoning the Metro trip. **Question:** What Borella bus-holding rule (none, schedule-based, or real-time ETA-based) and route-level timetable shift $\Delta$ minimize missed connections across both directions simultaneously without imposing excessive delay on on-board through-passengers?

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
2. **Bus journey layer:** Stop-by-stop bus progression over OpenStreetMap road distances, with Poisson passenger arrivals at a time-varying rate sampled by inverse transform and thinning, uniform downstream destinations, linear dwell times $t_{\text{dwell}} = (12 + 2 a_s + 3 b_s)/60\text{ min}$, and FIFO boarding capped at $C = 80$. Borella's scheduled time is interpolated between timetable points in proportion to road distance.
3. **Borella transfer layer:** Priority-queue discrete-event simulation pairing feeders and opposite-direction connectors under `none`, `schedule`, and `realtime` (ETA-based) holding policies, with first-come-first-served boarding shared with local Borella passengers, a passenger patience limit ($P = 60\text{ min}$) and ticket validity ($V = 120\text{ min}$) after which passengers leave for other transport. Policies minimize daily equivalent passenger-minutes $J(h, \Delta) = w_{\text{wait}} \mathbb{E}[\sum_i (w + W_i) + \pi_{\text{alt}} N_{\text{oow}}] + w_{\text{hold}} \mathbb{E}[\sum_b N_b \cdot \text{hold}_b]$.

## Verification

All nine verification checks (Markov stationary shares, calibrated corridor speeds and leg runtimes, zero-variance limit, closed-form Gaussian transfer probability, exact passenger conservation, $h=0$ policy equivalence, capacity invariants, common-random-numbers variance reduction, and thinning arrival intensity) plus $O(R^{-1/2})$ Monte Carlo error scaling are implemented with explicit `assert` statements in `notebook/metro-transfer-simulator.ipynb`.

![Verification plot](figures/verification.png)

## Concepts applied

This project applies next-event time-advance discrete-event simulation with FIFO passenger queueing, inverse-transform, thinning and Knuth/Box-Muller random variate generation, discrete-time Markov chains with stationary distribution calibration, and Monte Carlo integration with common random numbers and $O(R^{-1/2})$ confidence interval scaling based on the law of large numbers.

## Results, limitations and future work

- **Summary of findings (traffic calibrated to `cmb_traffic`, 52,255 journeys; OpenStreetMap road distances; R = 1,000 common-random-number days, 95% CI):**
  - **Baseline (current timetable, no holding):** `14.94 +/- 0.54%` of through-ticket passengers miss their connection (`21.32%` Kadawatha-Pettah, `10.25%` Pettah-Kadawatha) and `9.50 +/- 0.43%` give up and use other transport. Every scheduled connection is feasible on paper (the tightest have 6.6 and 8.4 min of slack), so misses come from traffic delay (`12.9%` timing vs `2.5%` full bus). Three evening Kadawatha-Pettah trips have no connection at all.
  - **Holding only (h = 3 min):** real-time ETA holding cuts misses to `12.67 +/- 0.50%` and the daily cost to `J = 9953 +/- 94` pax-min (from `10185 +/- 94`), with an on-board hold cost of only `21` pax-min against `192` for schedule holding.
  - **Best tested policy (CM03 timetable shifted -10 min, real-time holding up to h = 10 min):** `11.07 +/- 0.50%` missed (`9.43%` A, `12.27%` B), `3.89 +/- 0.29%` lost and `J = 9388 +/- 91` pax-min. Shifting CM01 by +10 min scores almost the same. Cost still falls at h = 10 min because the model does not charge knock-on delay to later trips, so 10 min is an operating cap, not an optimum.
  - **Capacity (C = inf):** removing the 80-passenger limit lowers Pettah-Kadawatha misses from `12.3%` to `6.8%` but barely changes Kadawatha-Pettah, so capacity matters for one direction only.
  - **Ticket validity:** with no patience or validity limit, `99.1%` of through passengers who board do so within 120 min of reaching Borella, so a 2-hour validity would rarely bind.
  - **Biggest unknown:** if early-running connectors waited at Borella for their timetable time, baseline misses would fall from `15.7%` to `7.3%` (R = 300), more than any policy tested. How Metro buses behave when early is the most valuable thing to check in the field.
- **Main limitations:** stop-level passenger arrival rates, transfer volumes and the Borella walk time (3.5 min) are placeholders; stop demand is the input the miss rate is most sensitive to. Borella's scheduled time assumes constant speed between timetable points; with a midpoint placement the tightest connections would be infeasible on paper. Stop coordinates are geocoded. Each direction has one traffic state that evolves independently of the others, and trips are simulated without vehicle chaining, so long holds look cheaper than they are.

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

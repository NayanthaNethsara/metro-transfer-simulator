# Theory and mathematics

## 1. Problem formulation

Route CM01 (Makumbura to Pettah, via Colombo Fort) and Route CM03 (Makumbura to Kadawatha) run every 15-35 minutes (116 trips a day, 12 + 11 buses) and stop at Borella at two stops about 370 m apart (`Borella (Singer Mega)` on CM01 and `Borella 02 (YMBA)` on CM03). We model a through-ticket serving both directions simultaneously:

- **Group A (Kadawatha to Pettah):** Feeder `CM03_KAD_to_MAK` connecting to `CM01_MAK_to_FOR`.
- **Group B (Pettah to Kadawatha):** Feeder `CM01_FOR_to_MAK` connecting to `CM03_MAK_to_KAD`.

The LMT-GO app gives departure times only. Each leg $\ell$ is given a scheduled run time $R_\ell$ (75 min for CM01 Makumbura-Pettah, 120 min for CM03; metrobus.lk travel times, consistent with the bus duties in the app), and Borella is placed in proportion to road distance (OSRM routing on OpenStreetMap roads), assuming constant scheduled speed along the leg:

$$f_\ell = \frac{d_{\text{origin}\to B}}{d_{\text{origin}\to\text{terminal}}}, \qquad T_{\text{Borella,sched}} = T_{\text{dep}} + f_\ell R_\ell$$

giving $f = 0.746$ (CM01 to Pettah), $0.253$ (CM01 to Makumbura), $0.519$ (CM03 to Kadawatha) and $0.478$ (CM03 to Makumbura).

Each feeder trip $f$ is mapped to its earliest opposite-direction connector $c(f)$ whose scheduled Borella time satisfies $T_{c,\text{sched}} \ge T_{f,\text{sched}}$. This is the connection a passenger would plan from the timetable; it does not require the walk to fit, so a connection can be infeasible on paper. With Borella walking time $w$, scheduled slack is:

$$s_f = T_{c(f),\text{sched}} - \left(T_{f,\text{sched}} + w\right)$$

Feeders whose scheduled Borella time falls after the last opposite-direction connector are classified as `out_of_window`. Their passengers have no Metro connection that day and are charged the alternative-travel penalty, so a timetable shift cannot lower the cost by pushing passengers out of the analysis window.

The through-ticket is part-paid: the passenger pays part of the fare on the first bus and the balance on the connecting bus, provided they board it within the validity window $V$. Seats are not reserved.

## 2. Assumptions

- Buses depart their origin terminals strictly on schedule (a timetable shift $\Delta$ moves only the connecting direction of a route, and only if every bus duty keeps a non-negative layover) and keep published times only there: a connector leaves Borella as soon as it has served the stop, even when running early, as Metro buses do today (author's observation). The opposite (a Borella timing point) is run as a scenario.
- Each route direction has its own traffic state, evolving independently on $\Delta t = 30\text{ min}$ slots as a time-inhomogeneous three-state Markov chain with one transition matrix per time-of-day band, estimated from `cmb_traffic`. All directions use the same estimated chain.
- Local stop passenger arrivals follow a non-homogeneous Poisson process (rate $\times 1.35$ at peak, `07:00-09:00` and `16:00-19:00`, $\times 0.85$ off-peak) beginning $30\text{ min}$ prior to each leg's first trip, sampled exactly by thinning, with uniform destinations over downstream stops and FIFO boarding up to $C = 80$. Base rates are set so the busiest buses fill at peak, as Metro buses do today (author's observation).
- Transfer passengers per feeder trip follow $m_f \sim \text{Poisson}(5.0)$ and walk $w = 3.5\text{ min}$ at Borella. Local Borella passengers and transfer passengers board the connector first come, first served in one queue.
- A passenger who misses the planned connector (timing) or is refused by a full bus (capacity) waits for the next connector only if it is scheduled within patience $P = 20\text{ min}$ and within ticket validity $V = 120\text{ min}$ of reaching Borella. Otherwise the passenger is lost to other transport and incurs the time already waited plus a $60\text{ min}$ alternative-travel penalty. Local passengers left behind by full buses follow the same patience rule.

## 3. Model equations

### Layer 1: Discrete-Time Markov Chain Traffic Model

Each route direction has its own state $S_t \in \{0:\text{Free},\, 1:\text{Slow},\, 2:\text{Jammed}\}$ on $\Delta t = 30\text{ min}$ slots, the sampling interval of the open `cmb_traffic` dataset (about 68,000 Google Maps travel-time observations, 05:00-22:00, of the 12 route directions on the roads CM01 and CM03 use: Borella-Fort, Borella-Dematagoda-Kiribathgoda, Kottawa-Pamankada via Maharagama and Nawinna, and Borella-Aturugiriya and Borella-Kaduwela via Rajagiriya and Battaramulla). An observation is Free, Slow or Jammed when its travel-time ratio (free-flow speed / speed) is below 1.3, between 1.3 and 2.0, or at least 2.0; free-flow speed is the 90th percentile of all of that corridor's observations.

**Transition matrices.** For each time-of-day band $b$ (early 05:00-07:00, morning peak 07:00-09:00, midday 09:00-16:00, evening peak 16:00-19:00, evening 19:00-22:00), the maximum-likelihood 30-min matrix counts consecutive observations of the same corridor 20-40 min apart:

$$\hat{P}^{(b)}_{ij} = \frac{n^{(b)}_{ij}}{\sum_k n^{(b)}_{ik}}$$

A row with fewer than 30 observed pairs in a band uses the all-day row. Traffic is free until 05:00 (the first hour of data, almost all free), then each step uses the matrix of its slot's band, so traffic builds up and clears through the day.

**State speeds.** The speed $v^{(b)}_k$ in state $k$ during band $b$ is the mean observed speed of those observations (free 28.8-35.8 km/h, slow 22.7-27.0 km/h, jammed 17.5-18.9 km/h). The stationary distribution $\pi^*$ solves $\pi^* \hat{P} = \pi^*$, $\sum_k \pi^*_k = 1$, and is used in the journey-speed check (Check 10). Bus cruising speed on leg $\ell$ is $\alpha_\ell v^{(b)}_k$, with $\alpha_\ell$ calibrated by bisection so that the mean simulated delay at Borella over 120 calibration days is zero, given the scheduled run times.

### Layer 2: Passenger Arrivals, Dwell Time, and Capacity

Discrete transitions use inverse-transform sampling from $U \sim \text{Uniform}(0, 1)$. Passenger arrivals at stop $s$ follow the non-homogeneous rate $\lambda_s(t) = \lambda_{s,0}\, m(t)$ and are generated by thinning (Lewis-Shedler): candidates are drawn at the maximum rate $\lambda^{\max}_s = 1.35\,\lambda_{s,0}$ and each is kept with probability $\lambda_s(t)/\lambda^{\max}_s$:

$$\Delta\tau = -\frac{\ln(1 - U_1)}{\lambda^{\max}_s}, \qquad \text{keep if } U_2 \le \frac{\lambda_s(t)}{\lambda^{\max}_s}, \qquad j = \min\left\{k : \sum_{m=0}^k P_{i,m} \ge U\right\}$$

At stop $s$, after $a_s$ passengers alight, $b_s = \min(q_s, C - (\text{load}_s - a_s))$ waiting passengers board, yielding linear dwell time:

$$t_{\text{dwell},s} = \frac{t_{\text{door}} + t_{\text{alight}}\, a_s + t_{\text{board}}\, b_s}{60}\quad [\text{min}]$$

### Layer 3: Holding Policies and Objective Function

Let $T_{c,\text{base}} = T_{c,\text{arr}} + t_{c,\text{dwell}}$ (the connector leaves as soon as it has served Borella) and $T_{c,\text{cap}} = T_{c,\text{base}} + h$.

- **No holding (`none`):** $T_{c,\text{dep}} = T_{c,\text{base}}$.
- **Schedule holding (`schedule`):** Hold up to $T_{c,\text{cap}}$ until all protected feeders $f \in \mathcal{F}_c$ have ready time $T_{f,\text{ready}} = T_{f,\text{arr}} + w$:

$$T_{c,\text{dep}} = \min\left(T_{c,\text{cap}},\, \max\left(T_{c,\text{base}},\, \max_{f \in \mathcal{F}_c} T_{f,\text{ready}}\right)\right)$$

- **Real-time ETA holding (`realtime`):** Restrict protection to feeders whose noisy ETA ready time $\hat{T}_{f,\text{ready}} = T_{f,\text{ready}} + \varepsilon_f$, $\varepsilon_f \sim \mathcal{N}(0, \sigma_{\text{eta}}^2)$ (Box-Muller), satisfies $\hat{T}_{f,\text{ready}} \le T_{c,\text{cap}}$, skipping futile holds for uncatchable feeders.

**Boarding and patience.** At departure, local Borella passengers and transfer passengers present at the stop board in arrival order up to $C - N_c$ places. A passenger left behind, or arriving after the planned connector has gone, at time $t$ waits only if

$$T_{\text{next,sched}} - t \le P \quad\text{and}\quad T_{\text{next,sched}} - T_{f,\text{ready}} \le V$$

and is otherwise lost to other transport.

The daily expected equivalent passenger-minute cost is:

$$J(h, \Delta) = w_{\text{wait}}\, \mathbb{E}\left[\sum_i (w + W_i) + \pi_{\text{alt}} N_{\text{oow}}\right] + w_{\text{hold}}\, \mathbb{E}\left[\sum_b N_b \cdot \text{hold}_b\right]$$

where $w$ is the walk between the two Borella stops, $W_i$ is the wait at the connector stop of in-window passenger $i$ (time waited plus $\pi_{\text{alt}}$ when lost) and $N_{\text{oow}}$ counts out-of-window passengers. Including the walk keeps a longer interchange from looking cheaper.

| Symbol | Meaning | Units | Value / range | Source |
|---|---|---|---|---|
| $C$ | Bus passenger capacity | pax | 80 | LMT-GO bus specification |
| $\lambda_{s,0}$ | Base stop arrival rates | pax/min | 0.20-1.30 per stop | Assumption, scaled so the busiest buses fill at peak (author's observation) |
| $m(t)$ | Peak and off-peak demand multipliers | - | 1.35, 0.85 | Assumption |
| - | Peak windows | HH:MM | 07:00-09:00, 16:00-19:00 | Slowest hours in `cmb_traffic`; used for traffic bands and demand |
| $\sigma_{\text{eta}}$ | Real-time ETA error (standard deviation) | min | 1.0 (0-4 tested) | Assumption |
| $t_{\text{door}}, t_{\text{alight}}, t_{\text{board}}$ | Door dead time, alighting, boarding rates | s, s/pax | 12.0, 2.0, 2.0 | Assumption; boarding is quick because fares are collected on board after boarding (author's observation) |
| $v^{(b)}_0, v^{(b)}_1, v^{(b)}_2$ | Speeds in Free, Slow, Jammed states per time band | km/h | 28.8-35.8, 22.7-27.0, 17.5-18.9 | Mean observed `cmb_traffic` speed in each state and band |
| $\hat{P}^{(b)}$ | 30-min traffic transition matrices (5 bands) | - | See `data/traffic/traffic_transitions.csv` | Maximum-likelihood estimate from consecutive `cmb_traffic` observations |
| $\alpha_\ell$ | Leg bus speed scaling factor | - | Calibrated per leg | Bisection to zero mean Borella delay against scheduled run times |
| $d$ | Stop-to-stop road distances | km | Per leg (see `docs/config.js`) | OSRM routing on OpenStreetMap between geocoded stops |
| $f_\ell$ | Borella position along the leg (CM01 to Pettah, CM01 to Makumbura, CM03 to Kadawatha, CM03 to Makumbura) | - | 0.746, 0.253, 0.519, 0.478 | Derived from road distances |
| $w$ | Borella interchange walking time | min | 3.5 (2.0-6.5 swept) | Placeholder; the walk along Baseline Road via Senanayake Junction is about 370 m (about 4.4-5.1 min at 1.2-1.4 m/s, plus a road crossing) |
| $m_f$ | Mean transfer passengers per feeder trip | pax/trip | 5.0 (3.0-8.0 swept) | Synthetic assumption |
| $P$ | Passenger patience after a missed or refused boarding | min | 20 (10-30 swept) | Assumption: author's observation that passengers wait 10-20 min at most |
| $V$ | Part-paid ticket validity | min | 120 | Proposed fare-integration rule |
| $\pi_{\text{alt}}$ | Alternative-travel penalty for lost passengers | min | 60 | Assumption |
| $h$ | Maximum Borella hold beyond the connector's natural departure | min | 0 to 5 (sweep to 10) | Policy decision variable; capped at 5 min |
| $\Delta_A, \Delta_B$ | Shift of the connecting direction (CM01 to Pettah, CM03 to Kadawatha) | min | -10 to +10 in 5 min steps, feasible duties only | Policy decision variable |
| $R_\ell$ | Scheduled run time | min | 75 (CM01), 120 (CM03) | metrobus.lk travel times (19 Nov 2026) |
| $w_{\text{wait}}, w_{\text{hold}}$ | Objective penalty weights | - | 2.0, 1.0 | Policy objective weight |

### Fleet, Timing Point and Extra Bus

- **Bus duties and fleet:** the bus registration numbers in the app give each bus's trips for the day: 12 CM01 and 11 CM03 buses, each alternating between its terminals. A duty is feasible when every trip starts after the previous one is scheduled to arrive. A timetable shift moves only the trips of the connecting direction (CM01 to Pettah for Group A, CM03 to Kadawatha for Group B) and is allowed only if every duty stays feasible, so the bus count is unchanged. CM03 to Kadawatha cannot move earlier, because one bus has no layover before that trip.
- **Borella timing point:** a connector never leaves Borella before its published time, $T_{c,\text{base}} = \max(T_{c,\text{sched}}, T_{c,\text{arr}} + t_{c,\text{dwell}})$. Waiting for the published time is charged to on-board passengers as hold time in $J$.
- **One extra bus:** round trips from Makumbura with the route's scheduled run times and a turnaround of $\tau = 10$ min, until the next Makumbura departure would be after the route's last one. The first departure (5-min grid) minimises $\sum_k h_k^2$ over the terminal headways (a random passenger waits $\sum h_k^2 / 2\sum h_k$ on average). Through demand stays fixed: extra feeder trips carry no through passengers.
- **Turnaround reliability:** a planned turnaround is late when the simulated terminal arrival is after the bus's next published departure (Borella holding not included, so a lower bound).

## 4. Numerical method

- **Next-event time advance:** Borella transfer events (`FEEDER_READY` with priority `0` and `CONNECTOR_CHECK` with priority `1`) are processed chronologically via a binary min-heap (`heapq`) with monotonic sequence tie-breaking.
- **Policy choice:** each group is evaluated over its own connector shift and the real-time hold limit on common random days. The recommended policy is the simplest grid policy (no shift first, then the shortest hold) that is not significantly worse than the best one in a paired day-by-day 95% confidence interval of the difference in $J$.
- **Root-finding calibration:** deterministic bisection over identical seeded calibration days solves the per-leg speed factor $\alpha_\ell$. The traffic matrices need no calibration: they are counted directly from the data.
- **Common random numbers (CRN):** each experiment draws its replications from its own named stream, `SeedSequence(42, spawn_key=(crc32(name),)).spawn(R)`, and each replication derives fixed child streams from its seed's `spawn_key` (`traffic`, `arrivals`, `destinations`, `transfers`, `eta`), so policy comparisons share identical daily random inputs and re-running one notebook cell does not change another experiment's seeds.

## 5. Verification

| Check | Expected | Obtained | Pass? |
|---|---|---|---|
| 1. Markov sampler | Simulated transition frequencies match each band's estimated matrix within 4 binomial standard errors (rows visited more than 200 times) | All 5 band matrices match | Pass |
| 2. Traffic by hour and leg runtimes | (a) Simulated state shares within 0.20 and mean speed within 12% of `cmb_traffic` for every hour 05:00-22:00; (b) leg calibration residual $< 2\%$ and mean Borella delay on an independent 80-day sample within $2\%$ of runtime or the $99\%$ combined Monte Carlo CI | (a) shares within `0.19`, speeds within `7.9%` (largest speed gaps 08:00 and 21:00); (b) residuals `0.01%-0.09%`, test delays `-0.22` to `+0.64 min`, all inside the CI | Pass |
| 3. Zero-variance deterministic limit | $P(\text{miss}) = 0.0$ when $\text{offset} \ge w$, uncapped | `missed_total = 0`, `made = 10`, wait `0.5 min` | Pass |
| 4. Closed-form Gaussian transfer probability (full event loop, 12,000 isolated pairs) | Matches $\Phi((s + h - w - (\mu_f - \mu_c))/\sqrt{\sigma_f^2+\sigma_c^2})$ within the 99% CI | One-sided `h=0/2/4m`: `0.3059/0.5636/0.8027` vs `0.3085/0.5662/0.7977`; two-sided: `0.7017` vs `0.7021` | Pass |
| 5. Exact passenger conservation | Stop queues and transfer outcomes conserve 100% of generated pax | Stop queues: boarded + unserved + abandoned = generated; transfers: made + missed + out-of-window = generated, lost $\le$ missed | Pass |
| 6. $h = 0$ limiting equivalence | `schedule(0)` and `realtime(0)` match `none` identically | All counts, wait times, and costs match identically | Pass |
| 7. Capacity invariant and uncapped equivalence | Load $\le 80$ always; uncapped produces 0 capacity misses | Capped max load `80 <= 80`; uncapped `missed_capacity = 0` | Pass |
| 8. CRN variance reduction | $\text{Var}_{\text{CRN}}(J(3)-J(0)) < \text{Var}_{\text{indep}}(J(3)-J(0))$ | Paired Var `500,255` vs independent Var `6,761,108` (`92.6%` reduction) | Pass |
| 9. Thinning arrival intensity | Mean daily peak and off-peak arrivals at a $0.4\text{ pax/min}$ test stop match $\int \lambda(t)\,dt$ within 3 SE ($400$ days) | Peak `162.3` vs `162.0`, off-peak `304.7` vs `306.0` | Pass |
| 10. Journey speed vs harmonic mean | Long-run journey distance/time within $0.5\%$ of $\pi^* \cdot v$ and closer to it than to the harmonic mean $1/\sum_i(\pi^*_i/v_i)$, since traffic states change with time, not distance (midday and evening-peak chains, pooled state speeds) | Off-peak `24.74` vs `24.74 km/h` (harmonic `24.48`), peak `22.46` vs `22.47 km/h` (harmonic `21.92`); 20 km journeys average `24.54` and `22.08 km/h` | Pass |
| 11. Exact-ETA limit of real-time holding (X3) | With $\sigma = 0$, identical connections to schedule holding on isolated feeder-connector pairs, and real-time hold $\le$ schedule hold on full days | `8,000` isolated pairs ($h = 3, 10$ min): identical connections; `400` day-direction cases: never holds longer, mean `203` pax-min of hold saved | Pass |
| 12. Bus duties | Every real bus duty alternates terminals with non-negative scheduled layovers | `12` CM01 + `11` CM03 buses, all duties feasible | Pass |
| 13. Extra-bus duty | Adds exactly one bus, every turnaround $\ge 10$ min | CM01: 10 extra trips on 1 extra bus; CM03: 6 extra trips on 1 extra bus; minimum turnaround `10` min | Pass |
| 14. Isolation of random draws | Extra Pettah-Makumbura trips leave Kadawatha-Pettah results identical | Identical for `none` and `realtime` ($h = 3$) | Pass |
| 15. Fixed demand | Through passengers per day unchanged when trips are added | Identical for both groups | Pass |
| X2. Monte Carlo $O(R^{-1/2})$ scaling | Log-log OLS slope of 95% CI half-width in $[-0.6, -0.4]$ | Log-log OLS slope `-0.415` over `R = 25..2000` | Pass |

![Verification plot](figures/verification.png)

## 6. Concepts applied

| Concept | Where it is used in this project |
|---|---|
| Discrete-event simulation and queueing | Stop FIFO boarding queues and `heapq` Borella interchange transfer loop |
| Input modelling and random variate generation | Inverse-transform exponential arrivals with thinning for the time-varying rate, discrete Markov transitions, Knuth Poisson counts, and Box-Muller Gaussian noise |
| Discrete-time Markov chains (DTMC) | 3-state traffic chain with maximum-likelihood transition matrices for five time-of-day bands, estimated from `cmb_traffic`; stationary distribution in the journey-speed check |
| Monte Carlo integration and law of large numbers | Multi-day replication ensembles, 95% confidence intervals, common random numbers variance reduction, and $O(R^{-1/2})$ error scaling |

## 7. References

See [REFERENCES.md](REFERENCES.md).

# Theory and mathematics

## 1. Problem formulation

Route CM01 (Makumbura to Colombo Fort/Pettah) and Route CM03 (Makumbura to Kadawatha) intersect at Borella across two adjacent stops (`Borella (Singer Mega)` on CM01 and `Borella 02 (YMBA)` on CM03). We model a through-ticket serving both directions simultaneously:

- **Group A (Kadawatha to Pettah):** Feeder `CM03_KAD_to_MAK` connecting to `CM01_MAK_to_FOR`.
- **Group B (Pettah to Kadawatha):** Feeder `CM01_FOR_to_MAK` connecting to `CM03_MAK_to_KAD`.

Borella is not a published timepoint. Its scheduled time on leg $\ell$ is interpolated between the bracketing timepoints in proportion to road distance (OSRM routing on OpenStreetMap roads), which assumes constant speed between the two timepoints:

$$\lambda_\ell = \frac{d_{\text{prev}\to B}}{d_{\text{prev}\to B} + d_{B\to\text{next}}}, \qquad T_{\text{Borella,sched}} = T_{\text{prev}} + \lambda_\ell \left(T_{\text{next}} - T_{\text{prev}}\right)$$

giving $\lambda = 0.509$ (CM01 to Fort), $0.435$ (CM01 to Makumbura), $0.764$ (CM03 to Kadawatha) and $0.254$ (CM03 to Makumbura).

Each feeder trip $f$ is mapped to its earliest opposite-direction connector $c(f)$ whose scheduled Borella time satisfies $T_{c,\text{sched}} \ge T_{f,\text{sched}}$. This is the connection a passenger would plan from the timetable; it does not require the walk to fit, so a connection can be infeasible on paper. With Borella walking time $w$, scheduled slack is:

$$s_f = T_{c(f),\text{sched}} - \left(T_{f,\text{sched}} + w\right)$$

Feeders whose scheduled Borella time falls after the last opposite-direction connector are classified as `out_of_window`. Their passengers have no Metro connection that day and are charged the alternative-travel penalty, so a timetable shift cannot lower the cost by pushing passengers out of the analysis window.

The through-ticket is part-paid: the passenger pays part of the fare on the first bus and the balance on the connecting bus, provided they board it within the validity window $V$. Seats are not reserved.

## 2. Assumptions

- Buses depart their origin terminals strictly on schedule (with shift $\Delta$ applied identically to both directions of the shifted route) and keep published times only there: a connector leaves Borella as soon as it has served the stop, even when running early. Because this is unverified, the opposite (early connectors wait for their timetable time) is run as a scenario; it roughly halves baseline misses.
- Each corridor's traffic congestion evolves independently on $\Delta t = 5\text{ min}$ slots as a time-inhomogeneous three-state Markov chain switching between off-peak and peak (`06:00-09:00` and `17:00-20:00`) transition matrices.
- Local stop passenger arrivals follow a non-homogeneous Poisson process (rate $\times 1.35$ at peak, $\times 0.85$ off-peak) beginning $30\text{ min}$ prior to each leg's first trip, sampled exactly by thinning, with uniform destinations over downstream stops and FIFO boarding up to $C = 80$.
- Transfer passengers per feeder trip follow $m_f \sim \text{Poisson}(5.0)$ and walk $w = 3.5\text{ min}$ at Borella. Local Borella passengers and transfer passengers board the connector first come, first served in one queue.
- A passenger who misses the planned connector (timing) or is refused by a full bus (capacity) waits for the next connector only if it is scheduled within patience $P = 60\text{ min}$ and within ticket validity $V = 120\text{ min}$ of reaching Borella. Otherwise the passenger is lost to other transport and incurs the time already waited plus a $60\text{ min}$ alternative-travel penalty. Local passengers left behind by full buses follow the same patience rule.

## 3. Model equations

### Layer 1: Discrete-Time Markov Chain Traffic Model

States $S_t \in \{0:\text{Free},\, 1:\text{Slow},\, 2:\text{Jammed}\}$ have speeds $v = (36, 20, 10)\text{ km/h}$ when calibrated to the `cmb_traffic` corridor file (the default; synthetic fallback $v = (30, 15, 5)\text{ km/h}$) and parametric transition matrix:

$$P(p) = \begin{pmatrix} 1 - p & 0.7p & 0.3p \\ 0.4(1 - p) & 0.4 & 0.2 + 0.4p \\ 0.1(1 - p) & 0.3(1 - p) & 0.6 + 0.4p \end{pmatrix}, \qquad p \in [0.01, 0.85]$$

The stationary distribution satisfies $\pi^*(p) P(p) = \pi^*(p)$ and $\sum_k \pi^*_k(p) = 1$, giving theoretical mean speed $\bar{v}(p) = \sum_{k=0}^2 \pi^*_k(p) v_k$. Bisection solves $\bar{v}(p) = v_{\text{target}}$ within the achievable bracket $[\bar{v}(0.85), \bar{v}(0.01)]$, with targets equal to the mean speed of the six `cmb_traffic` corridors ($29.37\text{ km/h}$ off-peak, $24.10\text{ km/h}$ peak; synthetic fallback $22.0$ and $14.0\text{ km/h}$). The higher empirical state speeds keep the observed off-peak target inside the achievable bracket. Bus cruising speed on leg $\ell$ in state $k$ is $\alpha_\ell v_k$.

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
| $t_{\text{door}}, t_{\text{alight}}, t_{\text{board}}$ | Door dead time, alighting, boarding rates | s, s/pax | 12.0, 2.0, 3.0 | Literature typical urban transit dwell |
| $v_0, v_1, v_2$ | Speeds in Free, Slow, Jammed states | km/h | 36.0, 20.0, 10.0 (fallback 30.0, 15.0, 5.0) | Model traffic parameterization |
| $\alpha_\ell$ | Leg bus speed scaling factor | - | Calibrated per leg | Bisection against published timetable |
| $d$ | Stop-to-stop road distances | km | Per leg (see `docs/config.js`) | OSRM routing on OpenStreetMap between geocoded stops |
| $\lambda_\ell$ | Borella position between timepoints | - | 0.509, 0.435, 0.764, 0.254 | Derived from road distances |
| $w$ | Borella interchange walking time | min | 3.5 (2.0-6.5 swept) | Placeholder pending field survey; OSM walking route between geocoded stops is 536 m (about 6.5 min) |
| $m_f$ | Mean transfer passengers per feeder trip | pax/trip | 5.0 (3.0-8.0 swept) | Synthetic assumption |
| $P$ | Passenger patience after a missed or refused boarding | min | 60 (30-120 swept) | Assumption: about one off-peak headway |
| $V$ | Part-paid ticket validity | min | 120 | Proposed fare-integration rule |
| $\pi_{\text{alt}}$ | Alternative-travel penalty for lost passengers | min | 60 | Assumption |
| $h$ | Maximum Borella hold beyond the connector's natural departure | min | 0.0 to 10.0 | Policy decision variable |
| $\Delta$ | Route-level timetable shift | min | -30 to +30 | Policy decision variable |
| $w_{\text{wait}}, w_{\text{hold}}$ | Objective penalty weights | - | 2.0, 1.0 | Policy objective weight |

### Fleet, Timing Point and Extra Bus

- **Buses needed by a timetable:** a bus can run trip $j$ after trip $i$ if $j$ starts at the terminal where $i$ ends and $T_{j,\text{dep}} \ge T_{i,\text{arr}} + \tau$, with turnaround $\tau = 10$ min. The fewest buses equals the number of trips minus a maximum matching on this graph (minimum path cover). CM01 and CM03 buses do not swap routes. The published timetables need 5 CM01 and 6 CM03 buses; a whole-route shift keeps every turnaround, so it needs the same number.
- **Borella timing point:** a connector never leaves Borella before its published time, $T_{c,\text{base}} = \max(T_{c,\text{sched}}, T_{c,\text{arr}} + t_{c,\text{dwell}})$. Waiting for the published time is charged to on-board passengers as hold time in $J$.
- **One extra bus:** round trips from Makumbura with the route's scheduled run times and $\tau = 10$ min, until the next Makumbura departure would be after the route's last one. The first departure (5-min grid) minimises $\sum_k h_k^2$ over the terminal headways (a random passenger waits $\sum h_k^2 / 2\sum h_k$ on average). Through demand stays fixed: extra feeder trips carry no through passengers.
- **Turnaround reliability:** a planned turnaround is late when the simulated terminal arrival plus $\tau$ is after the next trip's published departure (Borella holding not included, so a lower bound).

## 4. Numerical method

- **Next-event time advance:** Borella transfer events (`FEEDER_READY` with priority `0` and `CONNECTOR_CHECK` with priority `1`) are processed chronologically via a binary min-heap (`heapq`) with monotonic sequence tie-breaking.
- **Root-finding calibration:** Deterministic bisection over identical seeded calibration days solves both $p_{\text{offpeak}}, p_{\text{peak}}$ and per-leg $\alpha_\ell$.
- **Common random numbers (CRN):** each experiment draws its replications from its own named stream, `SeedSequence(42, spawn_key=(crc32(name),)).spawn(R)`, and each replication spawns isolated child streams (`traffic`, `arrivals`, `destinations`, `transfers`, `eta`), so policy comparisons share identical daily random inputs and re-running one notebook cell does not change another experiment's seeds.

## 5. Verification

| Check | Expected | Obtained | Pass? |
|---|---|---|---|
| 1. Markov stationary state shares | $\max |\hat{\pi} - \pi^*| < 0.015$ ($N=50{,}000$) | Off-peak `0.0060`, Peak `0.0038` | Pass |
| 2. Calibrated traffic speeds and leg runtimes | Speeds within $2\%$ of targets; leg calibration residual $< 2\%$; mean Borella delay on an independent 80-day sample within $2\%$ of runtime or the $99\%$ combined Monte Carlo CI | Off-peak `29.51` vs `29.37 km/h` (`0.49%`), peak `24.03` vs `24.10 km/h` (`0.30%`); calibration residuals `0.01%-0.07%`; test delays `-1.88` to `+0.69 min`, all inside the 99% combined CI | Pass |
| 3. Zero-variance deterministic limit | $P(\text{miss}) = 0.0$ when $\text{offset} \ge w$, uncapped | `missed_total = 0`, `made = 10`, wait `0.5 min` | Pass |
| 4. Closed-form Gaussian transfer probability (full event loop, 12,000 isolated pairs) | Matches $\Phi((s + h - w - (\mu_f - \mu_c))/\sqrt{\sigma_f^2+\sigma_c^2})$ within the 99% CI | One-sided `h=0/2/4m`: `0.3059/0.5636/0.8027` vs `0.3085/0.5662/0.7977`; two-sided: `0.7017` vs `0.7021` | Pass |
| 5. Exact passenger conservation | Stop queues and transfer outcomes conserve 100% of generated pax | Stop queues: boarded + unserved + abandoned = generated; transfers: made + missed + out-of-window = generated, lost $\le$ missed | Pass |
| 6. $h = 0$ limiting equivalence | `schedule(0)` and `realtime(0)` match `none` identically | All counts, wait times, and costs match identically | Pass |
| 7. Capacity invariant and uncapped equivalence | Load $\le 80$ always; uncapped produces 0 capacity misses | Capped max load `80 <= 80`; uncapped `missed_capacity = 0` | Pass |
| 8. CRN variance reduction | $\text{Var}_{\text{CRN}}(J(3)-J(0)) < \text{Var}_{\text{indep}}(J(3)-J(0))$ | Paired Var `121,380` vs independent Var `4,505,606` (`97.3%` reduction) | Pass |
| 9. Thinning arrival intensity | Mean daily peak and off-peak arrivals at a $0.4\text{ pax/min}$ test stop match $\int \lambda(t)\,dt$ within 3 SE ($400$ days) | Peak `195.0` vs `194.4`, off-peak `285.6` vs `285.6` | Pass |
| 10. Journey speed vs harmonic mean | Long-run journey distance/time within $1\%$ of $\pi^* \cdot v$ and more than $10\%$ from the harmonic mean $1/\sum_i(\pi^*_i/v_i)$, since traffic states change with time, not distance | Off-peak `29.39` vs `29.37 km/h` (harmonic `23.37`), peak `24.04` vs `24.10 km/h` (harmonic `18.00`); 20 km journeys average `28.00` and `22.52 km/h` | Pass |
| 11. Exact-ETA limit of real-time holding (X3) | With $\sigma = 0$, real-time hold $\le$ schedule hold and identical connections made | `400` day-direction cases ($h = 3, 10$ min): no longer hold, same connections, mean `131` pax-min of hold saved | Pass |
| 12. Fleet requirement | Published timetable bus count equals the count for every whole-route shift from $-30$ to $+30$ min | `5` CM01 + `6` CM03 buses for all shifts | Pass |
| 13. Extra-bus timetable | At most one more bus, every turnaround $\ge 10$ min | CM01: 4 extra trips on `6` buses; CM03: 6 extra trips on `7` buses; minimum turnaround `10` min | Pass |
| 14. Isolation of random draws | Extra Pettah-Makumbura trips leave Kadawatha-Pettah results identical | Identical for `none` and `realtime` ($h = 3$) | Pass |
| 15. Fixed demand | Through passengers per day unchanged when trips are added | Identical for both groups | Pass |
| X2. Monte Carlo $O(R^{-1/2})$ scaling | Log-log OLS slope of 95% CI half-width near $-0.5$ | Log-log OLS slope `-0.551` over `R = 25..2000` | Pass |

![Verification plot](figures/verification.png)

## 6. Concepts applied

| Concept | Where it is used in this project |
|---|---|
| Discrete-event simulation and queueing | Stop FIFO boarding queues and `heapq` Borella interchange transfer loop |
| Input modelling and random variate generation | Inverse-transform exponential arrivals with thinning for the time-varying rate, discrete Markov transitions, Knuth Poisson counts, and Box-Muller Gaussian noise |
| Discrete-time Markov chains (DTMC) | 3-state peak/off-peak traffic model, stationary distribution linear solver, and bisection speed calibration |
| Monte Carlo integration and law of large numbers | Multi-day replication ensembles, 95% confidence intervals, common random numbers variance reduction, and $O(R^{-1/2})$ error scaling |

## 7. References

See [REFERENCES.md](REFERENCES.md).

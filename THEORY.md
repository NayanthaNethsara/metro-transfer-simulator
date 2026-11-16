# Theory and mathematics

## 1. Problem formulation

Route CM01 (Makumbura to Colombo Fort/Pettah) and Route CM03 (Makumbura to Kadawatha) intersect at Borella across two adjacent stops (`Borella (Singer Mega)` on CM01 and `Borella 02 (YMBA)` on CM03). We model a through-ticket serving both directions simultaneously:

- **Group A (Kadawatha to Pettah):** Feeder `CM03_KAD_to_MAK` connecting to `CM01_MAK_to_FOR`.
- **Group B (Pettah to Kadawatha):** Feeder `CM01_FOR_to_MAK` connecting to `CM03_MAK_to_KAD`.

Each feeder trip $f$ is mapped to its earliest opposite-direction connector $c(f)$ whose scheduled Borella arrival/departure satisfies $T_{c,\text{sched}} \ge T_{f,\text{sched}}$. With Borella walking time $w$, scheduled slack is:

$$s_f = T_{c(f),\text{sched}} - \left(T_{f,\text{sched}} + w\right)$$

Feeders whose scheduled Borella time falls after the last opposite-direction connector are classified as `out_of_window` so passenger conservation holds without distorting in-window transfer rates.

## 2. Assumptions

- Buses depart their origin terminals strictly on schedule (with shift $\Delta$ applied identically to both directions of the shifted route).
- Each corridor's traffic congestion evolves independently on $\Delta t = 5\text{ min}$ slots as a time-inhomogeneous three-state Markov chain switching between off-peak and peak (`06:00-09:00` and `17:00-20:00`) transition matrices.
- Local stop passenger arrivals follow a non-homogeneous Poisson process beginning $30\text{ min}$ prior to each leg's first trip, with uniform destinations over downstream stops and FIFO boarding up to $C = 80$.
- Transfer passengers per feeder trip follow $m_f \sim \text{Poisson}(5.0)$, walk $w = 3.5\text{ min}$ at Borella, and wait in FIFO order for the next connecting bus with available seats.
- Any in-window transfer passenger left unboarded after the final connector of the day incurs a fixed $60.0\text{ min}$ missed-last-connection wait penalty.

## 3. Model equations

### Layer 1: Discrete-Time Markov Chain Traffic Model

States $S_t \in \{0:\text{Free},\, 1:\text{Slow},\, 2:\text{Jammed}\}$ have car speeds $v = (30, 15, 5)\text{ km/h}$ and parametric transition matrix:

$$P(p) = \begin{pmatrix} 1 - p & 0.7p & 0.3p \\ 0.4(1 - p) & 0.4 & 0.2 + 0.4p \\ 0.1(1 - p) & 0.3(1 - p) & 0.6 + 0.4p \end{pmatrix}, \qquad p \in [0.01, 0.85]$$

The stationary distribution satisfies $\pi^*(p) P(p) = \pi^*(p)$ and $\sum_k \pi^*_k(p) = 1$, giving theoretical mean speed $\bar{v}(p) = \sum_{k=0}^2 \pi^*_k(p) v_k$. Bisection solves $\bar{v}(p) = v_{\text{target}}$ within the achievable bracket $[\bar{v}(0.85), \bar{v}(0.01)]$. Bus cruising speed on leg $\ell$ in state $k$ is $\alpha_\ell v_k$.

### Layer 2: Passenger Arrivals, Dwell Time, and Capacity

Inter-arrival times and discrete transitions use explicit inverse-transform sampling from $U \sim \text{Uniform}(0, 1)$:

$$\Delta\tau = -\frac{\ln(1 - U)}{\lambda_s(t)}, \qquad j = \min\left\{k : \sum_{m=0}^k P_{i,m} \ge U\right\}$$

At stop $s$, after $a_s$ passengers alight, $b_s = \min(q_s, C - (\text{load}_s - a_s))$ waiting passengers board, yielding linear dwell time:

$$t_{\text{dwell},s} = \frac{t_{\text{door}} + t_{\text{alight}}\, a_s + t_{\text{board}}\, b_s}{60}\quad [\text{min}]$$

### Layer 3: Holding Policies and Objective Function

Let $T_{c,\text{base}} = \max(T_{c,\text{sched}}, T_{c,\text{arr}} + t_{c,\text{dwell}})$ and $T_{c,\text{cap}} = T_{c,\text{sched}} + h$.

- **No holding (`none`):** $T_{c,\text{dep}} = T_{c,\text{base}}$.
- **Schedule holding (`schedule`):** Hold up to $T_{c,\text{cap}}$ until all protected feeders $f \in \mathcal{F}_c$ have ready time $T_{f,\text{ready}} = T_{f,\text{arr}} + w$:

$$T_{c,\text{dep}} = \begin{cases} T_{c,\text{base}} & \text{if } \mathcal{F}_c = \emptyset \text{ or } T_{c,\text{base}} \ge T_{c,\text{cap}} \\ \min\left(T_{c,\text{cap}},\, \max\left(T_{c,\text{base}},\, \max_{f \in \mathcal{F}_c} T_{f,\text{ready}}\right)\right) & \text{otherwise} \end{cases}$$

- **Real-time ETA holding (`realtime`):** Restrict protection to feeders whose noisy ETA ready time $\hat{T}_{f,\text{ready}} = T_{f,\text{ready}} + \varepsilon_f$, $\varepsilon_f \sim \mathcal{N}(0, \sigma_{\text{eta}}^2)$ (Box-Muller), satisfies $\hat{T}_{f,\text{ready}} \le \max(T_{c,\text{base}}, T_{c,\text{cap}})$, skipping futile holds for uncatchable feeders.

The daily expected equivalent passenger-minute cost is:

$$J(h, \Delta) = w_{\text{wait}}\, \mathbb{E}\left[\sum_i W_i\right] + w_{\text{hold}}\, \mathbb{E}\left[\sum_b N_b \cdot \text{hold}_b\right]$$

| Symbol | Meaning | Units | Value / range | Source |
|---|---|---|---|---|
| $C$ | Bus passenger capacity | pax | 80 | LMT-GO bus specification |
| $t_{\text{door}}, t_{\text{alight}}, t_{\text{board}}$ | Door dead time, alighting, boarding rates | s, s/pax | 12.0, 2.0, 3.0 | Literature typical urban transit dwell |
| $v_0, v_1, v_2$ | Car speeds in Free, Slow, Jammed states | km/h | 30.0, 15.0, 5.0 | Model traffic parameterization |
| $\alpha_\ell$ | Leg bus speed scaling factor | - | Calibrated per leg | Bisection against published timetable |
| $w$ | Borella interchange walking time | min | 3.5 (2.0-5.5 swept) | Placeholder pending field survey |
| $m_f$ | Mean transfer passengers per feeder trip | pax/trip | 5.0 (3.0-8.0 swept) | Synthetic assumption |
| $h$ | Maximum allowed Borella hold past schedule | min | 0.0 to 6.0 | Policy decision variable |
| $\Delta$ | Route-level timetable shift | min | -30 to +30 | Policy decision variable |
| $w_{\text{wait}}, w_{\text{hold}}$ | Objective penalty weights | - | 2.0, 1.0 | Policy objective weight |

## 4. Numerical method

- **Next-event time advance:** Borella transfer events (`FEEDER_READY` with priority `0` and `CONNECTOR_CHECK` with priority `1`) are processed chronologically via a binary min-heap (`heapq`) with monotonic sequence tie-breaking.
- **Root-finding calibration:** Deterministic bisection over identical seeded calibration days solves both $p_{\text{offpeak}}, p_{\text{peak}}$ and per-leg $\alpha_\ell$.
- **Common random numbers (CRN):** `np.random.SeedSequence(42).spawn(R)` allocates isolated child streams (`traffic`, `arrivals`, `destinations`, `transfers`, `eta`) per replication so policy comparisons share identical daily random inputs.

## 5. Verification

| Check | Expected | Obtained | Pass? |
|---|---|---|---|
| 1. Markov stationary state shares | $\max |\hat{\pi} - \pi^*| < 0.015$ ($N=50{,}000$) | Off-peak `0.0062`, Peak `0.0034` | Pass |
| 2. Calibrated traffic speeds and leg runtimes | Relative error $< 2\%$ against targets/schedule | Off-peak speed `21.96 km/h` (`0.17%`), Peak speed `14.08 km/h` (`0.56%`); leg cal errs `0.00%-0.09%`, 80-day test delays `-0.65m` to `+1.35m` (inside 99% combined CI) | Pass |
| 3. Zero-variance deterministic limit | $P(\text{miss}) = 0.0$ when $\text{offset} \ge w$, uncapped | `missed_total = 0`, `made = 10` (`P(miss) = 0.0`) | Pass |
| 4. Closed-form Gaussian transfer probability | Matches $\Phi((s + h - w - (\mu_f - \mu_c))/\sqrt{\sigma_f^2+\sigma_c^2})$ in 95% CI | One-sided `h=0/2/4m`: `0.3120/0.5669/0.7993` vs `0.3085/0.5662/0.7977`; two-sided: `0.7043` vs `0.7021` ($N=12{,}000$) | Pass |
| 5. Exact passenger conservation | Stop queues and transfer outcomes conserve 100% of generated pax | Exact stop queue and transfer partition conservation verified | Pass |
| 6. $h = 0$ limiting equivalence | `schedule(0)` and `realtime(0)` match `none` identically | All counts, wait times, and costs match identically | Pass |
| 7. Capacity invariant and uncapped equivalence | Load $\le 80$ always; uncapped produces 0 capacity misses | Capped max load `80 <= 80`; uncapped `missed_capacity = 0` | Pass |
| 8. CRN variance reduction | $\text{Var}_{\text{CRN}}(J(3)-J(0)) < \text{Var}_{\text{indep}}(J(3)-J(0))$ | Paired Var `219,218.9` vs Indep Var `5,603,273.2` (`96.1%` reduction) | Pass |
| X2. Monte Carlo $O(R^{-1/2})$ scaling | Log-log OLS slope of 95% CI half-width near $-0.5$ | Log-log OLS slope `-0.476` over `R = 25..2000` | Pass |

![Verification plot](figures/verification.png)

## 6. Concepts applied

| Concept | Where it is used in this project |
|---|---|
| Discrete-event simulation and queueing | Stop FIFO boarding queues and `heapq` Borella interchange transfer loop |
| Input modelling and random variate generation | Explicit inverse-transform exponential arrivals, discrete Markov transitions, Knuth Poisson counts, and Box-Muller Gaussian noise |
| Discrete-time Markov chains (DTMC) | 3-state peak/off-peak traffic model, stationary distribution linear solver, and bisection speed calibration |
| Monte Carlo integration and law of large numbers | Multi-day replication ensembles, 95% confidence intervals, common random numbers variance reduction, and $O(R^{-1/2})$ error scaling |

## 7. References

See [REFERENCES.md](REFERENCES.md).

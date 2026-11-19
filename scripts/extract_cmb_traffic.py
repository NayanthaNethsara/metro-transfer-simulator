import argparse
import csv
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

COLOMBO_TZ = timezone(timedelta(hours=5, minutes=30))

# cmb_traffic routes on the roads CM01 and CM03 use: Borella to Kelaniya and Fort (both routes' city side),
# Kottawa-Pamankada (CM03 via Maharagama and Nawinna) and Borella-Aturugiriya/Kaduwela (CM01 via Rajagiriya and Battaramulla).
TARGET_CORRIDORS: Tuple[Tuple[str, str], ...] = (
    ("Kiribathgoda", "Dematagoda"),
    ("Dematagoda", "Kiribathgoda"),
    ("Dematagoda", "Borella"),
    ("Borella", "Dematagoda"),
    ("Fort", "Borella"),
    ("Borella", "Fort"),
    ("Kottawa", "Pamankada"),
    ("Pamankada", "Kottawa"),
    ("Borella", "Aturugiriya"),
    ("Aturugiriya", "Borella"),
    ("Borella", "Kaduwela"),
    ("Kaduwela", "Borella"),
)

# Peak hours where the data is slowest (hourly shares in cmb_traffic), and the hours Metro buses run.
PEAK_HOUR_RANGES: Tuple[Tuple[int, int], ...] = ((7, 9), (16, 19))
SERVICE_HOURS: Tuple[int, int] = (5, 22)
STATE_NAMES: Tuple[str, ...] = ("free", "slow", "jammed")
# Time-of-day bands for the traffic chain (start hour inclusive, end hour exclusive).
TRAFFIC_BANDS: Tuple[Tuple[str, int, int], ...] = (
    ("early", 5, 7), ("am_peak", 7, 9), ("midday", 9, 16), ("pm_peak", 16, 19), ("evening", 19, 22),
)


def traffic_band(hour_int: int) -> str:
    return next(name for name, start, end in TRAFFIC_BANDS if start <= hour_int < end)
PAIR_GAP_MIN: Tuple[float, float] = (20.0, 40.0)  # consecutive observations about one sampling interval (~30 min) apart


def is_peak_hour(hour_int: int) -> bool:
    return any(start <= hour_int < end for start, end in PEAK_HOUR_RANGES)


def normalize_place_name(raw_name: str) -> str:
    return raw_name.strip().lower()


def classify_corridor(origin_name: str, dest_name: str) -> str:
    norm_orig = normalize_place_name(origin_name)
    norm_dest = normalize_place_name(dest_name)
    for orig, dest in TARGET_CORRIDORS:
        if orig.lower() in norm_orig and dest.lower() in norm_dest:
            return f"{orig}_to_{dest}"
    return ""


def iter_traffic_records(repo_root: Path) -> Iterable[Dict]:
    tsv_path = repo_root / "data" / "all_journeys.tsv"
    if tsv_path.exists():
        with tsv_path.open("r", encoding="utf-8") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                yield row
        return

    for json_path in sorted(repo_root.rglob("*.json")):
        with json_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        records = payload if isinstance(payload, list) else [payload]
        for rec in records:
            if isinstance(rec, dict):
                yield rec


def parse_hour_and_timestamp(rec: Dict) -> Tuple[int, str]:
    if "ut_start" in rec and rec["ut_start"] not in (None, ""):
        ut_sec = float(rec["ut_start"])
        dt_local = datetime.fromtimestamp(ut_sec, tz=COLOMBO_TZ)
        return dt_local.hour, dt_local.isoformat(timespec="seconds")
    start_time_str = str(rec.get("start_time", rec.get("timestamp", "")))
    hour_int = int(start_time_str[11:13]) if len(start_time_str) >= 13 else -1
    return hour_int, start_time_str


def extract_corridor_rows(repo_root: Path) -> List[Dict]:
    extracted: List[Dict] = []
    for rec in iter_traffic_records(repo_root):
        route = rec.get("route") if isinstance(rec.get("route"), dict) else {}
        start_loc = route.get("start_location") if isinstance(route.get("start_location"), dict) else {}
        end_loc = route.get("end_location") if isinstance(route.get("end_location"), dict) else {}

        origin = str(rec.get("start_name", start_loc.get("name", rec.get("origin", rec.get("from", "")))))
        dest = str(rec.get("end_name", end_loc.get("name", rec.get("destination", rec.get("to", "")))))
        corridor_id = classify_corridor(origin, dest)
        if not corridor_id:
            continue

        hour_int, start_time_str = parse_hour_and_timestamp(rec)
        if hour_int < 0:
            continue

        duration_min = float(rec.get("duration_min", rec.get("duration", 0.0)))
        distance_km = float(rec.get("distance_km", rec.get("distance", 0.0)))
        speed_kmph = float(rec.get("avg_speed_kmph", rec.get("speed_kmph", rec.get("speed", 0.0))))
        if speed_kmph <= 0.0 and duration_min > 0.0 and distance_km > 0.0:
            speed_kmph = distance_km / (duration_min / 60.0)
        if speed_kmph <= 0.0:
            continue

        extracted.append({
            "corridor": corridor_id,
            "start_time": start_time_str,
            "hour": hour_int,
            "period": "peak" if is_peak_hour(hour_int) else "offpeak",
            "distance_km": round(distance_km, 3),
            "duration_min": round(duration_min, 2),
            "speed_kmph": round(speed_kmph, 2),
        })
    return extracted


def freeflow_speeds(rows: List[Dict]) -> Dict[str, float]:
    # Free-flow speed of each corridor: 90th percentile of its observed speeds.
    corridor_speeds: Dict[str, List[float]] = {}
    for row in rows:
        corridor_speeds.setdefault(row["corridor"], []).append(row["speed_kmph"])
    freeflow = {}
    for corridor_id, speeds in corridor_speeds.items():
        sorted_speeds = sorted(speeds)
        freeflow[corridor_id] = sorted_speeds[min(len(sorted_speeds) - 1, int(0.90 * len(sorted_speeds)))]
    return freeflow


def traffic_state(speed_kmph: float, freeflow_kmph: float) -> int:
    # Travel-time ratio (free-flow speed / speed): free < 1.3, slow 1.3-2.0, jammed >= 2.0.
    ratio = freeflow_kmph / max(0.5, speed_kmph)
    return 0 if ratio < 1.3 else (1 if ratio < 2.0 else 2)


def summarize_corridors(rows: List[Dict], freeflow: Dict[str, float]) -> List[Dict]:
    grouped: Dict[Tuple[str, str], List[Dict]] = {}
    for row in rows:
        grouped.setdefault((row["corridor"], row["period"]), []).append(row)
    summaries: List[Dict] = []
    for (corridor_id, period), group_rows in sorted(grouped.items()):
        speeds = [r["speed_kmph"] for r in group_rows]
        distances = [r["distance_km"] for r in group_rows]
        n_obs = len(speeds)
        mean_speed = sum(speeds) / n_obs
        variance = sum((v - mean_speed) ** 2 for v in speeds) / max(1, n_obs - 1)
        states = [traffic_state(v, freeflow[corridor_id]) for v in speeds]
        summaries.append({
            "corridor": corridor_id,
            "period": period,
            "n_observations": n_obs,
            "distance_km": round(sum(distances) / n_obs, 3),
            "freeflow_p90_kmph": round(freeflow[corridor_id], 2),
            "mean_speed_kmph": round(mean_speed, 2),
            "sd_speed_kmph": round(variance ** 0.5, 2),
            "share_free": round(states.count(0) / n_obs, 4),
            "share_slow": round(states.count(1) / n_obs, 4),
            "share_jammed": round(states.count(2) / n_obs, 4),
        })
    return summaries


def summarize_states(rows: List[Dict], freeflow: Dict[str, float]) -> List[Dict]:
    # Pooled over the corridors: share of observations and mean speed in each state, by time-of-day band.
    out = []
    for band, _, _ in TRAFFIC_BANDS:
        band_rows = [r for r in rows if traffic_band(r["hour"]) == band]
        for state_idx, state_name in enumerate(STATE_NAMES):
            speeds = [r["speed_kmph"] for r in band_rows if traffic_state(r["speed_kmph"], freeflow[r["corridor"]]) == state_idx]
            out.append({
                "band": band,
                "state": state_name,
                "n_observations": len(speeds),
                "share": round(len(speeds) / len(band_rows), 4),
                "mean_speed_kmph": round(sum(speeds) / len(speeds), 2) if speeds else 0.0,
            })
    return out


def summarize_hours(rows: List[Dict], freeflow: Dict[str, float]) -> List[Dict]:
    # Observed state shares and mean speed for each hour (used to validate the simulated daily traffic).
    out = []
    for hour in range(SERVICE_HOURS[0], SERVICE_HOURS[1]):
        hour_rows = [r for r in rows if r["hour"] == hour]
        states = [traffic_state(r["speed_kmph"], freeflow[r["corridor"]]) for r in hour_rows]
        out.append({
            "hour": hour,
            "n_observations": len(hour_rows),
            "share_free": round(states.count(0) / len(states), 4),
            "share_slow": round(states.count(1) / len(states), 4),
            "share_jammed": round(states.count(2) / len(states), 4),
            "mean_speed_kmph": round(sum(r["speed_kmph"] for r in hour_rows) / len(hour_rows), 2),
        })
    return out


def count_transitions(rows: List[Dict], freeflow: Dict[str, float]) -> List[Dict]:
    # State of each corridor at consecutive observations about one sampling interval apart; the pair is counted
    # in the band of its first observation.
    by_corridor: Dict[str, List[Tuple[float, int, int]]] = {}
    for r in rows:
        t = datetime.fromisoformat(r["start_time"]).timestamp()
        by_corridor.setdefault(r["corridor"], []).append((t, traffic_state(r["speed_kmph"], freeflow[r["corridor"]]), r["hour"]))
    counts: Dict[Tuple[str, int, int], int] = {}
    for series in by_corridor.values():
        series.sort()
        for (t1, s1, h1), (t2, s2, _) in zip(series, series[1:]):
            if PAIR_GAP_MIN[0] <= (t2 - t1) / 60.0 <= PAIR_GAP_MIN[1]:
                key = (traffic_band(h1), s1, s2)
                counts[key] = counts.get(key, 0) + 1
    return [
        {"band": band, "from_state": STATE_NAMES[a], "to_state": STATE_NAMES[b], "n_pairs": counts.get((band, a, b), 0)}
        for band, _, _ in TRAFFIC_BANDS for a in range(3) for b in range(3)
    ]


def write_summary_csv(summaries: List[Dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not summaries:
        raise ValueError("No matching corridor records were found in the specified repository.")
    fieldnames = list(summaries[0].keys())
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(summaries)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Borella-corridor traffic summaries from nuuuwan/cmb_traffic.")
    parser.add_argument("--cmb-repo", type=Path, required=True, help="Path to local clone of github.com/nuuuwan/cmb_traffic")
    parser.add_argument("--output-dir", type=Path, default=Path("data/traffic"))
    args = parser.parse_args()

    rows = extract_corridor_rows(args.cmb_repo)
    # Free flow comes from all hours (empty night roads); everything else only from the hours buses run.
    freeflow = freeflow_speeds(rows)
    rows = [r for r in rows if SERVICE_HOURS[0] <= r["hour"] < SERVICE_HOURS[1]]
    outputs = {
        "corridor_speeds.csv": summarize_corridors(rows, freeflow),
        "traffic_states.csv": summarize_states(rows, freeflow),
        "traffic_transitions.csv": count_transitions(rows, freeflow),
        "traffic_hourly.csv": summarize_hours(rows, freeflow),
    }
    for name, table in outputs.items():
        write_summary_csv(table, args.output_dir / name)
        print(f"Wrote {len(table)} rows to {args.output_dir / name}")
    print(f"From {len(rows)} records in service hours {SERVICE_HOURS[0]:02d}:00-{SERVICE_HOURS[1]:02d}:00")


if __name__ == "__main__":
    main()

import argparse
import csv
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

COLOMBO_TZ = timezone(timedelta(hours=5, minutes=30))

TARGET_CORRIDORS: Tuple[Tuple[str, str], ...] = (
    ("Kiribathgoda", "Dematagoda"),
    ("Dematagoda", "Kiribathgoda"),
    ("Dematagoda", "Borella"),
    ("Borella", "Dematagoda"),
    ("Fort", "Borella"),
    ("Borella", "Fort"),
)

PEAK_HOUR_RANGES: Tuple[Tuple[int, int], ...] = ((6, 9), (17, 20))


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
            "period": "peak" if is_peak_hour(hour_int) else "offpeak",
            "distance_km": round(distance_km, 3),
            "duration_min": round(duration_min, 2),
            "speed_kmph": round(speed_kmph, 2),
        })
    return extracted


def summarize_corridors(rows: List[Dict]) -> List[Dict]:
    grouped: Dict[Tuple[str, str], List[Dict]] = {}
    for row in rows:
        key = (row["corridor"], row["period"])
        grouped.setdefault(key, []).append(row)

    freeflow_by_corridor: Dict[str, float] = {}
    corridor_speeds: Dict[str, List[float]] = {}
    for row in rows:
        corridor_speeds.setdefault(row["corridor"], []).append(row["speed_kmph"])
    for corridor_id, speeds in corridor_speeds.items():
        sorted_speeds = sorted(speeds)
        idx_90 = min(len(sorted_speeds) - 1, int(0.90 * len(sorted_speeds)))
        freeflow_by_corridor[corridor_id] = sorted_speeds[idx_90]

    summaries: List[Dict] = []
    for (corridor_id, period), group_rows in sorted(grouped.items()):
        speeds = [r["speed_kmph"] for r in group_rows]
        distances = [r["distance_km"] for r in group_rows]
        v_free = freeflow_by_corridor[corridor_id]
        n_obs = len(speeds)
        mean_speed = sum(speeds) / n_obs
        variance = sum((v - mean_speed) ** 2 for v in speeds) / max(1, n_obs - 1)
        ttr_values = [v_free / max(0.5, v) for v in speeds]
        share_free = sum(1 for r in ttr_values if r < 1.3) / n_obs
        share_slow = sum(1 for r in ttr_values if 1.3 <= r < 2.0) / n_obs
        share_jammed = sum(1 for r in ttr_values if r >= 2.0) / n_obs

        summaries.append({
            "corridor": corridor_id,
            "period": period,
            "n_observations": n_obs,
            "distance_km": round(sum(distances) / n_obs, 3),
            "freeflow_p90_kmph": round(v_free, 2),
            "mean_speed_kmph": round(mean_speed, 2),
            "sd_speed_kmph": round(variance ** 0.5, 2),
            "share_free": round(share_free, 4),
            "share_slow": round(share_slow, 4),
            "share_jammed": round(share_jammed, 4),
        })
    return summaries


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
    parser = argparse.ArgumentParser(description="Extract Borella-corridor speed summaries from nuuuwan/cmb_traffic.")
    parser.add_argument("--cmb-repo", type=Path, required=True, help="Path to local clone of github.com/nuuuwan/cmb_traffic")
    parser.add_argument("--output", type=Path, default=Path("data/traffic/corridor_speeds.csv"))
    args = parser.parse_args()

    rows = extract_corridor_rows(args.cmb_repo)
    summaries = summarize_corridors(rows)
    write_summary_csv(summaries, args.output)
    print(f"Wrote {len(summaries)} corridor summary rows from {len(rows)} records to {args.output}")


if __name__ == "__main__":
    main()

"""Build docs/corridor-geo.js: road-following geometry for the web demo map.

Stop coordinates were geocoded with OpenStreetMap Nominatim. Road paths come from the
public OSRM driving router (motorways excluded) and the OSM foot router for the Borella walk.
Geometry is for display only; the simulator still uses the segment distances in docs/config.js.
"""

import argparse
import json
import math
import urllib.request
from pathlib import Path

STOP_COORDINATES = {
    "Makumbura": (6.84065, 79.97589),
    "Sethsiripaya": (6.90343, 79.91527),
    "Rajagiriya": (6.90819, 79.89335),
    "Borella (Singer Mega)": (6.91096, 79.87650),
    "Town Hall": (6.91579, 79.86373),
    "Pettah": (6.93352, 79.85554),
    "Colombo Fort": (6.93373, 79.85008),
    "Kadawatha": (7.00522, 79.95467),
    "Kelaniya University": (6.97422, 79.91539),
    "Cambell Park": (6.92002, 79.87714),
    "Borella 02 (YMBA)": (6.91338, 79.87745),
    "Narahenpita Junction": (6.89240, 79.87701),
    "Nawinna": (6.85289, 79.91786),
    "Apeksha Hospital": (6.83732, 79.92029),
}

LEG_STOPS = {
    "CM01_MAK_to_FOR": ["Makumbura", "Sethsiripaya", "Rajagiriya", "Borella (Singer Mega)", "Town Hall", "Colombo Fort"],
    "CM01_FOR_to_MAK": ["Colombo Fort", "Pettah", "Town Hall", "Borella (Singer Mega)", "Rajagiriya", "Sethsiripaya", "Makumbura"],
    "CM03_MAK_to_KAD": ["Makumbura", "Apeksha Hospital", "Nawinna", "Narahenpita Junction", "Borella 02 (YMBA)", "Cambell Park", "Kelaniya University", "Kadawatha"],
    "CM03_KAD_to_MAK": ["Kadawatha", "Kelaniya University", "Cambell Park", "Borella 02 (YMBA)", "Narahenpita Junction", "Nawinna", "Apeksha Hospital", "Makumbura"],
}

DRIVING_ROUTER_URL = "https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson"
WALKING_ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/{coords}?overview=full&geometries=geojson"
SIMPLIFY_TOLERANCE_M = 6.0


def fetch_route(url_template, stop_names):
    coords = ";".join(f"{STOP_COORDINATES[name][1]},{STOP_COORDINATES[name][0]}" for name in stop_names)
    request = urllib.request.Request(url_template.format(coords=coords), headers={"User-Agent": "corridor-geometry-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get("code") != "Ok":
        raise RuntimeError(f"router error for {stop_names}: {payload.get('code')}")
    route = payload["routes"][0]
    path = [(lat, lng) for lng, lat in route["geometry"]["coordinates"]]
    snapped = [(wp["location"][1], wp["location"][0]) for wp in payload["waypoints"]]
    leg_distances_km = [leg["distance"] / 1000.0 for leg in route["legs"]]
    return path, snapped, leg_distances_km


def local_xy_m(point, origin):
    lat0 = math.radians(origin[0])
    return (
        (point[1] - origin[1]) * 111320.0 * math.cos(lat0),
        (point[0] - origin[0]) * 110540.0,
    )


def find_stop_vertices(path, snapped_stops):
    vertex_indices = []
    search_from = 0
    for stop in snapped_stops:
        best_idx = min(
            range(search_from, len(path)),
            key=lambda i: math.hypot(*local_xy_m(path[i], stop)),
        )
        vertex_indices.append(best_idx)
        search_from = best_idx
    vertex_indices[0] = 0
    vertex_indices[-1] = len(path) - 1
    return vertex_indices


def point_to_segment_distance_m(point, seg_start, seg_end):
    px, py = local_xy_m(point, seg_start)
    ex, ey = local_xy_m(seg_end, seg_start)
    seg_len_sq = ex * ex + ey * ey
    if seg_len_sq == 0:
        return math.hypot(px, py)
    t = max(0.0, min(1.0, (px * ex + py * ey) / seg_len_sq))
    return math.hypot(px - t * ex, py - t * ey)


def simplify_keep(path, keep_indices, tolerance_m):
    keep = [False] * len(path)
    for idx in keep_indices:
        keep[idx] = True

    def douglas_peucker(first, last):
        if last <= first + 1:
            return
        worst_idx, worst_dist = first, -1.0
        for i in range(first + 1, last):
            dist = point_to_segment_distance_m(path[i], path[first], path[last])
            if dist > worst_dist:
                worst_idx, worst_dist = i, dist
        if worst_dist > tolerance_m:
            keep[worst_idx] = True
            douglas_peucker(first, worst_idx)
            douglas_peucker(worst_idx, last)

    anchors = sorted(set(keep_indices))
    for first, last in zip(anchors, anchors[1:]):
        douglas_peucker(first, last)

    new_index = {}
    simplified = []
    for i, point in enumerate(path):
        if keep[i]:
            new_index[i] = len(simplified)
            simplified.append([round(point[0], 6), round(point[1], 6)])
    return simplified, [new_index[i] for i in keep_indices]


def build_geometry():
    legs = {}
    for leg_key, stop_names in LEG_STOPS.items():
        path, snapped, leg_distances_km = fetch_route(DRIVING_ROUTER_URL, stop_names)
        stop_vertices = find_stop_vertices(path, snapped)
        simplified, simplified_stop_vertices = simplify_keep(path, stop_vertices, SIMPLIFY_TOLERANCE_M)
        legs[leg_key] = {
            "path": simplified,
            "stopVertex": simplified_stop_vertices,
            "roadSegmentKm": [round(d, 2) for d in leg_distances_km],
        }
        print(f"{leg_key}: {len(path)} -> {len(simplified)} vertices, road km {legs[leg_key]['roadSegmentKm']}")

    walk_path, _, walk_km = fetch_route(WALKING_ROUTER_URL, ["Borella 02 (YMBA)", "Borella (Singer Mega)"])
    walk_simplified, _ = simplify_keep(walk_path, [0, len(walk_path) - 1], 2.0)
    print(f"Borella walk: {walk_km[0] * 1000:.0f} m")

    return {
        "source": "Stops: OpenStreetMap Nominatim. Roads: OSRM (OpenStreetMap data). Display only.",
        "stops": {name: list(coord) for name, coord in STOP_COORDINATES.items()},
        "legs": legs,
        "borellaWalk": {"path": walk_simplified, "distanceM": round(walk_km[0] * 1000)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / "docs" / "corridor-geo.js"))
    args = parser.parse_args()
    geometry = build_geometry()
    Path(args.output).write_text(
        "window.CORRIDOR_GEO = " + json.dumps(geometry, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()

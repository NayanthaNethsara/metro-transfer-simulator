"""Build docs/corridor-geo.js: road-following geometry for the web demo map.

Stop coordinates were geocoded with OpenStreetMap Nominatim. Road paths come from the
public OSRM driving router (motorways excluded). The Borella walk follows Baseline Road to
Senanayake Junction and then the CM01 road, as on the LMT-GO app map; the OSM foot router
detours through side streets because it does not treat that stretch of Baseline Road as walkable.
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
SENANAYAKE_JUNCTION = (6.911237, 79.877535)  # Baseline Road x D. S. Senanayake Mawatha (vertex of the CM03 road path)
SIMPLIFY_TOLERANCE_M = 6.0
DETOUR_MAX_CHORD_M = 200.0
DETOUR_MIN_LENGTH_M = 60.0
DETOUR_MAX_LENGTH_M = 4000.0
DETOUR_MIN_LENGTH_RATIO = 3.0
SPUR_RETRACE_RADIUS_M = 40.0
SPUR_RETRACE_SHARE = 0.8
STOP_ON_DETOUR_MARGIN_M = 25.0


def fetch_route(url_template, coordinates):
    coords = ";".join(f"{lng},{lat}" for lat, lng in coordinates)
    request = urllib.request.Request(url_template.format(coords=coords), headers={"User-Agent": "corridor-geometry-builder/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get("code") != "Ok":
        raise RuntimeError(f"router error for {coordinates}: {payload.get('code')}")
    route = payload["routes"][0]
    path = [(lat, lng) for lng, lat in route["geometry"]["coordinates"]]
    snapped = [(wp["location"][1], wp["location"][0]) for wp in payload["waypoints"]]
    return path, snapped


def distance_m(a, b):
    return math.hypot(*local_xy_m(b, a))


def cumulative_distances_m(path):
    cumulative = [0.0]
    for a, b in zip(path, path[1:]):
        cumulative.append(cumulative[-1] + distance_m(a, b))
    return cumulative


def distance_to_polyline_m(point, polyline):
    if len(polyline) == 1:
        return distance_m(point, polyline[0])
    return min(point_to_segment_distance_m(point, a, b) for a, b in zip(polyline, polyline[1:]))


def retraces_same_road(path, start, end):
    tip = max(range(start, end + 1), key=lambda k: distance_m(path[start], path[k]))
    outbound = path[start:tip + 1]
    inbound = path[tip:end + 1]
    near = sum(1 for point in outbound if distance_to_polyline_m(point, inbound) <= SPUR_RETRACE_RADIUS_M)
    return near >= SPUR_RETRACE_SHARE * len(outbound)


def detour_serves_a_stop(path, start, end, stop_points):
    detour = path[start:end + 1]
    return any(
        distance_to_polyline_m(stop, detour) + STOP_ON_DETOUR_MARGIN_M < point_to_segment_distance_m(stop, path[start], path[end])
        for stop in stop_points
    )


def is_removable_detour(path, start, end, stop_points):
    return retraces_same_road(path, start, end) or not detour_serves_a_stop(path, start, end, stop_points)


def find_detour_end(path, cumulative, start, stop_points):
    candidates = []
    j = start + 2
    while j < len(path) and cumulative[j] - cumulative[start] <= DETOUR_MAX_LENGTH_M:
        length = cumulative[j] - cumulative[start]
        chord = distance_m(path[start], path[j])
        if length >= DETOUR_MIN_LENGTH_M and chord <= DETOUR_MAX_CHORD_M and length >= DETOUR_MIN_LENGTH_RATIO * chord:
            candidates.append(j)
        j += 1
    for end in reversed(candidates):
        if is_removable_detour(path, start, end, stop_points):
            return end
    return None


def remove_detours(path, stop_points):
    """Remove detours the router makes only because a stop coordinate lies off the bus corridor.

    A detour leaves the path and rejoins it within DETOUR_MAX_CHORD_M after travelling at least
    DETOUR_MIN_LENGTH_RATIO times that distance. It is cut when it comes back along the same road (a spur into
    a side street) or when no stop lies on it (a loop around a block to approach a stop from the other side).
    Loops that pass a stop, such as one-way streets around Pettah, are kept.
    """
    cumulative = cumulative_distances_m(path)
    kept_path = []
    i = 0
    while i < len(path):
        kept_path.append(path[i])
        detour_end = find_detour_end(path, cumulative, i, stop_points)
        i = detour_end if detour_end is not None else i + 1
    return kept_path


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


def on_road_stop_positions(legs):
    positions = {}
    for leg_key, stop_names in LEG_STOPS.items():
        path = legs[leg_key]["path"]
        for name, vertex in zip(stop_names, legs[leg_key]["stopVertex"]):
            positions.setdefault(name, []).append(path[vertex])
    return {
        name: [round(sum(p[0] for p in points) / len(points), 6), round(sum(p[1] for p in points) / len(points), 6)]
        for name, points in positions.items()
    }


def build_geometry():
    legs = {}
    for leg_key, stop_names in LEG_STOPS.items():
        stop_coordinates = [STOP_COORDINATES[name] for name in stop_names]
        path, _ = fetch_route(DRIVING_ROUTER_URL, stop_coordinates)
        corridor_path = remove_detours(path, stop_coordinates)
        corridor_stop_vertices = find_stop_vertices(corridor_path, stop_coordinates)
        simplified, simplified_stop_vertices = simplify_keep(corridor_path, corridor_stop_vertices, SIMPLIFY_TOLERANCE_M)
        cumulative = cumulative_distances_m(simplified)
        legs[leg_key] = {
            "path": simplified,
            "stopVertex": simplified_stop_vertices,
            "roadSegmentKm": [
                round((cumulative[b] - cumulative[a]) / 1000.0, 2)
                for a, b in zip(simplified_stop_vertices, simplified_stop_vertices[1:])
            ],
        }
        print(f"{leg_key}: {len(path)} -> {len(corridor_path)} after spur removal -> {len(simplified)} vertices, road km {legs[leg_key]['roadSegmentKm']}")

    stops = on_road_stop_positions(legs)
    walk_path = [tuple(stops["Borella 02 (YMBA)"]), SENANAYAKE_JUNCTION, tuple(stops["Borella (Singer Mega)"])]
    walk_m = cumulative_distances_m(walk_path)[-1]
    print(f"Borella walk: {walk_m:.0f} m")

    return {
        "source": "Stops: OpenStreetMap Nominatim, moved onto the bus corridor. Roads: OSRM (OpenStreetMap data). Display only.",
        "stops": stops,
        "legs": legs,
        "borellaWalk": {"path": walk_path, "distanceM": round(walk_m)},
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

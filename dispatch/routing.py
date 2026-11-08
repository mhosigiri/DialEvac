"""OpenStreetMap driving routes, in the wire format consumed by the map/bridge.

OSMnx preserves directed streets and computes free-flow travel time, not live ETA.
Only network edges become route geometry: snapping never draws a driveway/air line.
"""

import hashlib
import math
import os
from functools import lru_cache
from pathlib import Path
from threading import RLock

import osmnx as ox

ox.settings.requests_timeout = 90
ox.settings.use_cache = True
ox.settings.cache_folder = os.environ.get("OSMNX_CACHE_DIR", ".cache/osmnx")
ox.settings.http_user_agent = "HackUTD-Dispatch-Routing/1.0"
ox.settings.overpass_url = os.environ.get("OSMNX_OVERPASS_URL") or ox.settings.overpass_url
_graph_lock = RLock()


class NoRoute(ValueError):
    """No drivable road-network path reaches the supplied locations."""


def point(value):
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise ValueError("Expected longitude,latitude")
    lng, lat = map(float, value)
    if not math.isfinite(lng) or not math.isfinite(lat) or abs(lng) > 180 or abs(lat) > 85:
        raise ValueError("Coordinates outside supported longitude/latitude range")
    return lng, lat


def route_bbox(origin, destination):
    # Grid alignment reuses graphs for nearby assignments; padding permits detours.
    if ox.distance.great_circle(origin[1], origin[0], destination[1], destination[0]) > 50_000:
        raise ValueError("Route exceeds the supported 50 km dispatch radius")
    grid, pad = 0.05, 0.02
    west = math.floor((min(origin[0], destination[0]) - pad) / grid) * grid
    south = math.floor((min(origin[1], destination[1]) - pad) / grid) * grid
    east = math.ceil((max(origin[0], destination[0]) + pad) / grid) * grid
    north = math.ceil((max(origin[1], destination[1]) + pad) / grid) * grid
    area = (east - west) * (north - south) * 111_320**2 * math.cos(math.radians((north + south) / 2))
    if west < -180 or east > 180 or south < -85 or north > 85 or area > 2_500_000_000:
        raise ValueError("Route search area exceeds supported coverage")
    return tuple(round(v, 6) for v in (west, south, east, north))


@lru_cache(maxsize=4)
def _load_graph(bbox, graphml):
    if graphml:
        graph = ox.io.load_graphml(graphml)
    else:
        digest = hashlib.sha256(repr(bbox).encode()).hexdigest()[:20]
        path = Path(ox.settings.cache_folder) / f"drive-{digest}.graphml"
        if path.exists():
            graph = ox.io.load_graphml(path)
        else:
            graph = ox.graph.graph_from_bbox(bbox, network_type="drive", retain_all=True)
            path.parent.mkdir(parents=True, exist_ok=True)
            ox.io.save_graphml(graph, path)
    graph = ox.routing.add_edge_speeds(graph, fallback=30)
    return ox.routing.add_edge_travel_times(graph)


def get_graph(bbox):
    # Avoid simultaneous Overpass downloads for the same graph on a cold start.
    with _graph_lock:
        return _load_graph(bbox if not os.environ.get("OSMNX_GRAPHML") else None, os.environ.get("OSMNX_GRAPHML"))


def bearing(a, b):
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    return math.degrees(math.atan2(math.sin(lng2 - lng1) * math.cos(lat2),
        math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lng2 - lng1))) % 360


def road_name(value):
    return (", ".join(str(v) for v in value) if isinstance(value, list) else str(value or ""))[:180]


def route_on_graph(graph, origin, destination):
    """Pure route calculation against a graph, also used by offline regression tests."""
    origin, destination = point(origin), point(destination)
    nodes, distances = ox.distance.nearest_nodes(graph, X=[origin[0], destination[0]], Y=[origin[1], destination[1]], return_dist=True)
    if max(distances) > 1000:
        raise NoRoute("No drivable road within 1 km of a requested location")
    path = ox.routing.shortest_path(graph, int(nodes[0]), int(nodes[1]), weight="travel_time")
    if path is None:
        raise NoRoute("No connected driving route in the downloaded road network")
    coordinates, steps = [], []
    distance = duration = 0.0
    previous_bearing = None
    for u, v in zip(path, path[1:]):
        # Match the weight used by shortest_path when choosing parallel OSM edges.
        edge = min(graph[u][v].values(), key=lambda e: e["travel_time"])
        start, end = (graph.nodes[u]["x"], graph.nodes[u]["y"]), (graph.nodes[v]["x"], graph.nodes[v]["y"])
        vertices = list(edge["geometry"].coords) if "geometry" in edge else [start, end]
        if ox.distance.great_circle(start[1], start[0], vertices[-1][1], vertices[-1][0]) < ox.distance.great_circle(start[1], start[0], vertices[0][1], vertices[0][0]):
            vertices.reverse()
        vertices = [p for i, p in enumerate(vertices) if not i or p != vertices[i - 1]]
        if len(vertices) < 2:
            raise NoRoute("Road edge has invalid geometry")
        heading = bearing(vertices[0], vertices[1])
        turn = ((heading - previous_bearing + 180) % 360 - 180) if previous_bearing is not None else 0
        modifier = "straight" if abs(turn) < 30 else "uturn" if abs(turn) > 170 else ("right" if turn > 0 else "left")
        kind = "depart" if previous_bearing is None else "continue" if modifier == "straight" else "turn"
        name = road_name(edge.get("name", edge.get("ref", "")))
        length, seconds = float(edge["length"]), float(edge["travel_time"])
        if not all(math.isfinite(v) and v >= 0 for v in (length, seconds)):
            raise NoRoute("Road edge has invalid distance or travel time")
        # Merge same-road continuations to keep instructions readable on longer trips.
        if steps and kind == "continue" and steps[-1]["name"] == name:
            steps[-1]["distance"] += length
            steps[-1]["duration"] += seconds
        else:
            steps.append({"name": name, "distance": length, "duration": seconds,
                "maneuver": {"type": kind, "modifier": modifier, "location": list(vertices[0])}})
        coordinates.extend(vertices[1:] if coordinates and coordinates[-1] == vertices[0] else vertices)
        distance += length
        duration += seconds
        previous_bearing = bearing(vertices[-2], vertices[-1])
    if not coordinates:  # Both locations snap to the same network node.
        node = graph.nodes[path[0]]
        coordinates = [(node["x"], node["y"])] * 2
    steps.append({"name": "", "distance": 0, "duration": 0,
        "maneuver": {"type": "arrive", "location": list(coordinates[-1])}})
    if len(coordinates) > 10_000 or len(steps) > 500:
        raise NoRoute("Route exceeds supported geometry or directions limits")
    return {"code": "Ok", "source": "osmnx", "attribution": "© OpenStreetMap contributors",
        "routes": [{"distance": distance, "duration": duration,
            "geometry": {"type": "LineString", "coordinates": coordinates}, "legs": [{"steps": steps}]}]}


def driving_route(origin, destination):
    origin, destination = point(origin), point(destination)
    return route_on_graph(get_graph(route_bbox(origin, destination)), origin, destination)

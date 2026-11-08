import json
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from urllib.request import urlopen

import networkx as nx
import osmnx as ox
import pytest
from shapely.geometry import LineString

import routing
import routing_server


@pytest.fixture
def graph():
    g = nx.MultiDiGraph(crs="epsg:4326")
    for node, xy in {1: (-96.75, 32.98), 2: (-96.749, 32.98), 3: (-96.749, 32.981), 4: (-96.75, 32.981)}.items():
        g.add_node(node, x=xy[0], y=xy[1])
    # The quickest path is longer: shortest_path must optimize time, not length.
    g.add_edge(1, 3, length=100, travel_time=100, name="Slow direct road")
    g.add_edge(1, 2, length=120, travel_time=12, name="East Road",
        geometry=LineString([(-96.749, 32.98), (-96.7495, 32.9801), (-96.75, 32.98)]))
    g.add_edge(1, 2, length=110, travel_time=30, name="Slow parallel road")
    g.add_edge(2, 3, length=140, travel_time=14, name="North Road")
    return g


def test_driving_path_uses_fastest_directed_edges_and_full_geometry(graph):
    result = routing.route_on_graph(graph, (-96.75, 32.98), (-96.749, 32.981))
    r = result["routes"][0]
    assert result["source"] == "osmnx"
    assert r["distance"] == 260
    assert r["duration"] == 26
    assert r["geometry"]["coordinates"] == [(-96.75, 32.98), (-96.7495, 32.9801), (-96.749, 32.98), (-96.749, 32.981)]
    steps = r["legs"][0]["steps"]
    assert [s["name"] for s in steps] == ["East Road", "North Road", ""]
    assert steps[1]["maneuver"]["modifier"] == "left"
    assert steps[-1]["maneuver"]["type"] == "arrive"


def test_no_path_never_draws_a_straight_line_or_reverses_a_one_way(graph):
    with pytest.raises(routing.NoRoute, match="connected"):
        routing.route_on_graph(graph, (-96.749, 32.981), (-96.75, 32.98))
    with pytest.raises(routing.NoRoute, match="within 1 km"):
        routing.route_on_graph(graph, (-97.75, 32.98), (-96.749, 32.981))


def test_same_node_returns_zero_distance_and_arrival(graph):
    route = routing.route_on_graph(graph, (-96.75, 32.98), (-96.75, 32.98))["routes"][0]
    assert route["distance"] == route["duration"] == 0
    assert len(route["geometry"]["coordinates"]) == 2
    assert route["legs"][0]["steps"][0]["maneuver"]["type"] == "arrive"


@pytest.mark.parametrize("value", [(float("nan"), 30), (-96, float("inf")), (181, 30), (0, 86), (0,)])
def test_invalid_coordinates(value):
    with pytest.raises(ValueError):
        routing.point(value)


def test_download_area_is_bounded_and_contains_both_locations():
    origin, destination = (-96.75, 32.98), (-96.749, 32.981)
    west, south, east, north = routing.route_bbox(origin, destination)
    for lng, lat in (origin, destination):
        assert west < lng < east and south < lat < north
    with pytest.raises(ValueError, match="50 km"):
        routing.route_bbox(origin, (-95, 30))


def test_graph_download_is_cached_in_memory_and_on_disk(monkeypatch, tmp_path, graph):
    nx.set_edge_attributes(graph, "residential", "highway")
    calls = []
    def download(bbox, **options):
        calls.append((bbox, options))
        return graph
    monkeypatch.delenv("OSMNX_GRAPHML", raising=False)
    monkeypatch.setattr(ox.settings, "cache_folder", str(tmp_path))
    monkeypatch.setattr(ox.graph, "graph_from_bbox", download)
    routing._load_graph.cache_clear()
    try:
        bbox = (-96.76, 32.97, -96.74, 32.99)
        first = routing.get_graph(bbox)
        assert routing.get_graph(bbox) is first
        routing._load_graph.cache_clear()
        restored = routing.get_graph(bbox)
        assert len(calls) == 1
        assert calls[0][1]["network_type"] == "drive"
        assert len(restored) == len(first)
        assert all(e["travel_time"] >= 0 for _, _, e in restored.edges(data=True))
        # A configured GraphML graph works without any Overpass request.
        monkeypatch.setenv("OSMNX_GRAPHML", str(next(tmp_path.glob("*.graphml"))))
        assert len(routing.get_graph(None)) == len(first)
        assert len(calls) == 1
    finally:
        routing._load_graph.cache_clear()


def test_http_contract_health_geometry_directions_and_failures(monkeypatch, graph):
    monkeypatch.setattr(routing_server, "driving_route", lambda a, b: routing.route_on_graph(graph, a, b))
    server = ThreadingHTTPServer(("127.0.0.1", 0), routing_server.Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    root = f"http://127.0.0.1:{server.server_port}"
    def get(path):
        with urlopen(root + path, timeout=5) as response:
            return json.load(response)
    try:
        assert get("/health")["provider"] == "osmnx"
        path = "/route/v1/driving/-96.75,32.98;-96.749,32.981"
        assert "legs" not in get(path)["routes"][0]
        assert len(get(path + "?steps=true")["routes"][0]["legs"][0]["steps"]) == 3
        assert get("/route/v1/driving/-96.749,32.981;-96.75,32.98")["code"] == "NoRoute"
        with pytest.raises(HTTPError) as error:
            get("/route/v1/driving/nan,32;-96,32")
        assert error.value.code == 400
        def fail(*_):
            raise RuntimeError("upstream failed")
        monkeypatch.setattr(routing_server, "driving_route", fail)
        with pytest.raises(HTTPError) as error:
            get(path)
        assert error.value.code == 503
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

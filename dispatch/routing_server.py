"""Run: uv run python routing_server.py (http://127.0.0.1:8800).

The existing dispatch clients consume an OSRM-compatible GET route endpoint;
all routes here are computed locally by OSMnx using OpenStreetMap data.
"""

import json
import os
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from routing import NoRoute, driving_route, point


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/health":
            self.send_json(200, {"ok": True, "provider": "osmnx", "data": "OpenStreetMap"})
            return
        prefix = "/route/v1/driving/"
        if not parsed.path.startswith(prefix):
            self.send_json(404, {"code": "NotFound"})
            return
        try:
            origin, destination = (point(v.split(",")) for v in parsed.path[len(prefix):].split(";"))
            payload = driving_route(origin, destination)
            if parse_qs(parsed.query).get("steps", ["false"])[0] != "true":
                payload["routes"][0].pop("legs", None)
            self.send_json(200, payload)
        except NoRoute as error:
            self.send_json(200, {"code": "NoRoute", "message": str(error)})
        except ValueError as error:
            self.send_json(400, {"code": "InvalidQuery", "message": str(error)})
        except Exception:
            traceback.print_exc()
            self.send_json(503, {"code": "Unavailable", "message": "OpenStreetMap road network unavailable"})

    def log_message(self, fmt, *args):
        # Request URLs contain household coordinates: do not log them.
        pass


if __name__ == "__main__":
    host, port = os.environ.get("OSMNX_HOST", "127.0.0.1"), int(os.environ.get("OSMNX_PORT", "8800"))
    print(f"OSMnx routing listening on http://{host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()

"""Static server for floodplain-map (port 4178, binds 127.0.0.1 only).

Run from outputs/floodplain-map:   python3 tools/serve.py   -> http://127.0.0.1:4178/index.html
Also accepts POST /save?name=<[a-z0-9-]> with a PNG data URL, written to images/<name>.png (optional stills).
"""
import base64, http.server, os, re, socketserver, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'images')
os.makedirs(OUT, exist_ok=True)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # live development: always serve the latest file
        super().end_headers()
    def log_message(self, *a): pass
    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = (q.get('name') or [''])[0]
        if not re.fullmatch(r'[a-z0-9-]{1,60}', name):
            self.send_error(400, 'bad name'); return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        data = base64.b64decode(body.split(',', 1)[1])
        with open(os.path.join(OUT, name + '.png'), 'wb') as f: f.write(data)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        print('saved', name, len(data), 'bytes', flush=True)

socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', 4178), H) as s:
    print('serving', ROOT, 'on http://127.0.0.1:4178', flush=True); s.serve_forever()

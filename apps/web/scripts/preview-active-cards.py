"""Serve only the standalone sample playground; no app, API or filesystem browsing."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import argparse
import mimetypes

PAGE = Path(__file__).resolve().parent.parent / "active-cards-playground.html"

SOUNDS = PAGE.parent / "public/sounds/active-cards"
AUDIO = {"/sounds/active-cards/" + p.name: p for p in SOUNDS.glob("*.wav")}

class Preview(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if route in ("/", "/active-cards-playground.html"):
            content, content_type = PAGE.read_bytes(), "text/html; charset=utf-8"
        elif route in AUDIO:
            content, content_type = AUDIO[route].read_bytes(), "audio/wav"
        elif args.settings_root and route == "/active-cards-settings.html":
            content, content_type = (Path(args.settings_root) / "active-cards-settings.html").read_bytes(), "text/html; charset=utf-8"
        elif args.settings_root and route.startswith("/assets/") and route in assets:
            asset = assets[route]
            content, content_type = asset.read_bytes(), mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=0)
parser.add_argument("--settings-root", type=Path)
args = parser.parse_args()
assets = {"/assets/" + p.name: p for p in (args.settings_root / "assets").glob("*") if p.is_file()} if args.settings_root else {}
class PreviewServer(HTTPServer):
    # Static responses are small; serialize them and buffer the browser's asset burst.
    # Avoid spawning unbounded request threads on a shared development host.
    request_queue_size = 64

server = PreviewServer(("127.0.0.1", args.port), Preview)
page = "active-cards-settings.html" if args.settings_root else "active-cards-playground.html"
print(f"http://127.0.0.1:{server.server_port}/{page}", flush=True)
server.serve_forever()

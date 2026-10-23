"""Serve only the standalone sample playground; no app, API or filesystem browsing."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

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
args = parser.parse_args()
server = ThreadingHTTPServer(("127.0.0.1", args.port), Preview)
print(f"http://127.0.0.1:{server.server_port}/active-cards-playground.html", flush=True)
server.serve_forever()

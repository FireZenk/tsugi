"""Dev harness server: serves the repo root with caching disabled.

    python3 dev/serve.py            # then open http://127.0.0.1:8777/dev/harness.html
"""
import http.server
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print("CR+ harness: http://127.0.0.1:8777/dev/harness.html")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8777), NoCache).serve_forever()

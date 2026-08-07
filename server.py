#!/usr/bin/env python3
"""Dev static server with no-cache headers (avoids stale JS during dev)."""
import http.server
import socketserver

PORT = 8091
DIRECTORY = "."

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True  # must be set BEFORE bind (TIME_WAIT restart)

with Server(("", PORT), Handler) as httpd:
    print(f"serving {DIRECTORY} on :{PORT} (no-cache)")
    httpd.serve_forever()

#!/usr/bin/env python3
"""Static file server for local dev that never caches -- every response gets
Cache-Control: no-store, so editing style.css/app.js/problems.json is always
reflected on the next reload without a hard-refresh."""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    http.server.test(HandlerClass=NoCacheHandler, port=port)

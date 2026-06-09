#!/usr/bin/env python3
"""
本機開發用伺服器：提供靜態檔案，並將 /api、/api-write 代理到 Google Apps Script，避免 CORS。
"""
import json
import os
import urllib.parse
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

# 與 js/app.jsx、admin.html 中的 Google 網頁應用程式 URL 一致；也可用環境變數 OVERRIDE_API_URL 覆寫
GOOGLE_SCRIPT_URL = os.environ.get(
    "OVERRIDE_API_URL",
    "https://script.google.com/macros/s/AKfycbyyFnwQVNVamiWRD23U4TOIKnR_iHqfO3ObFmFl_lfqepR8tvFgvWvm5YBqxuFWZiaBfw/exec",
)


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        path = self.path.split("?")[0]
        if path in ("/api", "/api-write"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api" or self.path.startswith("/api?"):
            self._proxy_to_google(method="GET")
            return
        self._serve_static()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api-write" or self.path.startswith("/api-write?"):
            self._proxy_to_google(method="POST")
            return
        self.send_response(404)
        self.end_headers()

    def _proxy_to_google(self, method="GET"):
        url = GOOGLE_SCRIPT_URL
        if method == "GET" and "?" in self.path:
            q = self.path.split("?", 1)[1]
            url = url + ("&" if "?" in url else "?") + q
        req = urllib.request.Request(url, method=method)
        if method == "POST":
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len) if content_len else b""
            req.data = body
            req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read() if e.fp else b"{}")
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": True, "message": str(e)}).encode())

    def _serve_static(self):
        path = self.path.split("?")[0]
        if path == "/":
            path = "/index.html"
        file_path = os.path.join(os.path.dirname(__file__), path.lstrip("/"))
        if not os.path.isfile(file_path):
            self.send_response(404)
            self.end_headers()
            return
        ext = os.path.splitext(file_path)[1].lower()
        mime = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".jsx": "application/javascript",
            ".json": "application/json",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.end_headers()
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())

    def log_message(self, format, *args):
        print(format % args)


def main():
    port = int(os.environ.get("PORT", 3000))
    server = HTTPServer(("", port), Handler)
    print("本機伺服器: http://localhost:%d" % port)
    print("  - 顧客頁: http://localhost:%d/" % port)
    print("  - 後台:   http://localhost:%d/admin.html" % port)
    print("  - /api、/api-write 會代理到 Google Apps Script")
    server.serve_forever()


if __name__ == "__main__":
    main()

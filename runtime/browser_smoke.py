"""Run the architecture prototype in a real browser worker using local assets."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            content = b"<!doctype html><title>Interpreter prototype</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            super().do_GET()

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(Path(__file__).parent)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel=args.channel)
            try:
                page = browser.new_page()
                requests = []
                page.on("request", lambda request: requests.append(request.url))
                page.goto(origin)
                run = """instructions => new Promise((resolve, reject) => {
                  const worker = new Worker('/worker.mjs', {type: 'module'});
                  const timer = setTimeout(() => {
                    worker.terminate(); reject(new Error('Prototype worker timed out.'));
                  }, 10000);
                  worker.onmessage = event => {
                    clearTimeout(timer); worker.terminate(); resolve(event.data);
                  };
                  worker.onerror = event => {
                    clearTimeout(timer); worker.terminate(); reject(new Error(event.message));
                  };
                  worker.postMessage({program: {format: 'pocket-python-prototype', version: 0, instructions}, maxSteps: 5});
                })"""
                answer = page.evaluate(run, [["const", "9007199254740993"], ["const", "1"], ["add"], ["return"]])
                assert answer == {"ok": True, "result": {"type": "int", "value": "9007199254740994"}}, answer
                stopped = page.evaluate(run, [["jump", 0]])
                assert not stopped["ok"] and stopped["error"]["code"] == "BUDGET", stopped
                rejected = page.evaluate(run, [["unknown"]])
                assert not rejected["ok"] and rejected["error"]["code"] == "BYTECODE", rejected
                assert all(url.startswith(origin + "/") for url in requests), requests
                print("Browser version:", browser.version)
                print("Independent bytecode prototype: browser precision, budget and malformed-input checks passed.")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()

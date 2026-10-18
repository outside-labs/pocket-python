"""Real-browser worker, scoped service-worker and offline acceptance checks."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import tempfile
from threading import Thread

from playwright.sync_api import expect, sync_playwright

from pocket_python.assets import file_record, json_bytes, read_runtime
from pocket_python.bundles import read_bundle
from pocket_python.web import build_web


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, default=Path("build/runtime"))
    parser.add_argument("--channel", default=None, help="Use chrome for an installed local Chrome; omit for Playwright Chromium.")
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    runtime = read_runtime(args.runtime, args.runtime / "runtime-lock.json")
    fixture = project / "tests/fixtures/hello"
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        output = root / "nested" / "hello"
        receipt = build_web(read_bundle(fixture), runtime, output, title="Pocket Python · Offline")
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel=args.channel, headless=True)
                context = browser.new_context()
                requests, errors = [], []
                context.on("request", lambda request: requests.append(request.url))
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                base = f"http://127.0.0.1:{server.server_port}"
                page.goto(base + "/nested/hello/")
                expect(page.locator("#status")).to_have_text("Finished", timeout=20000)
                expect(page.locator("#output")).to_have_text("hello pocket\n")
                expect(page.locator("#offline")).to_have_text("Offline ready on this device", timeout=20000)
                page.wait_for_function("navigator.serviceWorker.controller !== null")
                page.evaluate("caches.open('unrelated-application-cache')")
                context.set_offline(True)
                page.reload()
                expect(page.locator("#status")).to_have_text("Finished", timeout=20000)
                expect(page.locator("#output")).to_have_text("hello pocket\n")
                expect(page.locator("#offline")).to_have_text("Offline ready on this device")
                page.locator("#run").click()
                expect(page.locator("#status")).to_have_text("Finished", timeout=20000)
                expect(page.locator("#output")).to_have_text("hello pocket\n")
                if args.screenshot:
                    args.screenshot.parent.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(args.screenshot), full_page=True)
                context.set_offline(False)
                # A neighboring app has its own service-worker scope and cache.
                # Known synthetic fixtures are modified and rehashed explicitly.
                for name, source in [
                    ("failure", b"raise RuntimeError('known failure')\n"),
                    ("loop", b"print('loop-start')\nwhile True:\n    pass\n"),
                ]:
                    source_root = root / (name + "-source")
                    shutil.copytree(fixture, source_root)
                    manifest_path = source_root / "SHIMIFY-MANIFEST.json"
                    manifest = json.loads(manifest_path.read_bytes())
                    entry = manifest["entrypoint"]
                    (source_root / entry).write_bytes(source)
                    updated = file_record(entry, source)
                    for record in manifest["files"]:
                        if record["path"] == entry:
                            record.update(updated)
                    for record in manifest["sources"]:
                        if record["output"] == entry:
                            record.update({key: updated[key] for key in ["sha256", "size_bytes"]})
                    manifest_path.write_bytes(json_bytes(manifest))
                    build_web(read_bundle(source_root), runtime, root / "nested" / name)
                    page.goto(base + "/nested/" + name + "/")
                    if name == "failure":
                        expect(page.locator("#status")).to_have_text("Error", timeout=20000)
                        expect(page.locator("#output")).to_contain_text("known failure")
                    else:
                        expect(page.locator("#output")).to_contain_text("loop-start", timeout=20000)
                        page.locator("#stop").click()
                        expect(page.locator("#status")).to_have_text("Stopped")
                        page.locator("#run").click()
                        expect(page.locator("#output")).to_contain_text("loop-start", timeout=20000)
                        page.locator("#stop").click()
                    expect(page.locator("#offline")).to_have_text("Offline ready on this device", timeout=20000)
                keys = page.evaluate("caches.keys()")
                assert "unrelated-application-cache" in keys
                assert any("/nested/hello/" in key for key in keys)
                assert any("/nested/failure/" in key for key in keys)
                assert not errors, errors
                assert all(url.startswith(base + "/") for url in requests), requests
                browser.close()
                print(json.dumps({"browser": "passed", "offline_reload": "passed", "subdirectory": "passed", "errors_and_stop": "passed", "source_bytes": receipt["size"]["application_source_bytes"], "runtime_bytes": receipt["size"]["runtime_asset_bytes"], "artifact_bytes": receipt["size"]["artifact_bytes"]}, sort_keys=True))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()

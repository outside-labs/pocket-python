"""Local-asset browser shell and MicroPython worker templates."""

PAGE = '''<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#213b45">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="icon" href="./icon.svg" type="image/svg+xml">
<title>{title}</title>
<style>
:root {{ color-scheme: light dark; font: 17px/1.6 system-ui,sans-serif; }}
body {{ max-width: 52rem; margin: 8vh auto; padding: 0 1.5rem; }}
h1 {{ line-height: 1.2; }}
button {{ font: inherit; padding: .35rem 1rem; margin-right: .5rem; cursor: pointer; }}
pre {{ min-height: 10rem; padding: 1.25rem; border: 1px solid #789; border-radius: .5rem; white-space: pre-wrap; overflow-wrap: anywhere; }}
small {{ display: block; margin-top: 1rem; }}
</style>
<main>
<h1>{title}</h1>
<p>Python runs on your device.</p>
<p id="status" role="status">Ready</p>
<button id="run" type="button">Run</button><button id="stop" type="button" disabled>Stop</button>
<pre id="output" aria-label="Python output"></pre>
<small id="offline" role="status">Preparing offline files…</small>
</main>
<script type="module" src="./app.js"></script>
</html>
'''

APP = '''const output = document.querySelector("#output");
const status = document.querySelector("#status");
const run = document.querySelector("#run");
const stop = document.querySelector("#stop");
const offline = document.querySelector("#offline");
let worker;
function finish(message) {
  if (worker) worker.terminate();
  worker = undefined;
  run.disabled = false;
  stop.disabled = true;
  status.textContent = message;
}
function start() {
  if (worker) worker.terminate();
  output.textContent = "";
  status.textContent = "Running…";
  run.disabled = true;
  stop.disabled = false;
  worker = new Worker(new URL("./worker.js", import.meta.url), {type: "module"});
  worker.onmessage = ({data}) => {
    if (data.type === "stdout" || data.type === "stderr") output.textContent += data.text;
    if (data.type === "error") { output.textContent += "\\n" + data.text; finish("Error"); }
    if (data.type === "done") finish("Finished");
  };
  worker.onerror = (event) => { output.textContent += "\\n" + event.message; finish("Error"); };
  worker.postMessage({type: "run"});
}
run.addEventListener("click", start);
stop.addEventListener("click", () => finish("Stopped"));
async function prepareOffline() {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers require HTTPS or localhost.");
  const registration = await navigator.serviceWorker.register(new URL("./service-worker.js", import.meta.url), {scope: "./"});
  const installing = registration.installing || registration.waiting;
  if (installing && installing.state !== "activated") {
    await new Promise((resolve, reject) => {
      function changed() {
        if (installing.state === "activated") resolve();
        if (installing.state === "redundant") reject(new Error("Offline installation failed."));
      }
      installing.addEventListener("statechange", changed);
      changed();
    });
  }
  await navigator.serviceWorker.ready;
  offline.textContent = "Offline ready on this device";
}
prepareOffline().catch(error => { offline.textContent = "Offline unavailable: " + error.message; });
start();
'''

WORKER = '''import {loadMicroPython} from "./runtime/micropython.mjs";
let started = false;
async function get(path) {
  const url = new URL(path.split("/").map(encodeURIComponent).join("/"), import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load " + path + ": " + response.status);
  return response;
}
self.onmessage = async ({data}) => {
  if (started || data.type !== "run") return;
  started = true;
  const stdout = new TextDecoder();
  const stderr = new TextDecoder();
  try {
    const config = await (await get("app-config.json")).json();
    const mp = await loadMicroPython({
      url: new URL("./runtime/micropython.wasm", import.meta.url).href,
      linebuffer: false,
      stdout: bytes => postMessage({type: "stdout", text: stdout.decode(bytes, {stream: true})}),
      stderr: bytes => postMessage({type: "stderr", text: stderr.decode(bytes, {stream: true})})
    });
    let entry;
    for (const source of config.sources) {
      const bytes = new Uint8Array(await (await get(source.url)).arrayBuffer());
      const path = "/app/" + source.path;
      mp.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      mp.FS.writeFile(path, bytes);
      if (source.path === config.entrypoint) entry = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    }
    if (entry === undefined) throw new Error("Application entrypoint is missing.");
    mp.globals.set("__file__", "/app/" + config.entrypoint);
    mp.runPython("import sys\\nsys.path.insert(0, '/app')\\nsys.argv = [__file__]\\n");
    mp.runPython(entry);
    postMessage({type: "stdout", text: stdout.decode()});
    postMessage({type: "stderr", text: stderr.decode()});
    postMessage({type: "done"});
  } catch (error) {
    postMessage({type: "error", text: (error.type || error.name || "Error") + ": " + error.message});
  }
};
'''

SERVICE_WORKER = '''const FILES = __FILES__;
const PREFIX = "pocket-python:" + self.registration.scope + ":";
const CACHE = PREFIX + "__VERSION__";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(path => new URL(path, self.registration.scope).href))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
'''

ICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="#213b45"/><path d="M57 49h48a30 30 0 0 1 0 60H81v34H57zM81 73v12h24a6 6 0 0 0 0-12z" fill="#f4da8b"/></svg>'''

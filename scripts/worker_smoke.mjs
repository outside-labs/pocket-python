import {Worker, parentPort, workerData, isMainThread} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import assert from "node:assert/strict";

if (!isMainThread) {
  globalThis.self = globalThis;
  globalThis.postMessage = data => parentPort.postMessage(data);
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.protocol !== "file:") throw new Error("Unexpected network request: " + url);
    return new Response(await readFile(fileURLToPath(url)));
  };
  await import(pathToFileURL(path.join(workerData.directory, "worker.js")).href);
  parentPort.on("message", data => self.onmessage({data}));
} else {
  const directory = path.resolve(process.argv[2]);
  const mode = process.argv[3] || "success";
  let stdout = "";
  await new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {workerData: {directory}});
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Runtime timed out")); }, 15000);
    const finish = callback => { clearTimeout(timeout); worker.terminate(); callback(); };
    worker.on("error", error => finish(() => reject(error)));
    worker.on("message", data => {
      if (data.type === "stdout") stdout += data.text;
      if (mode === "stop" && stdout.includes("loop-start")) finish(resolve);
      if (data.type === "error") finish(() => {
        if (mode === "error") { assert.match(data.text, /RuntimeError.*known failure/s); resolve(); }
        else reject(new Error(data.text));
      });
      if (data.type === "done") finish(() => {
        assert.equal(mode, "success");
        assert.match(stdout, /hello pocket/);
        resolve();
      });
    });
    worker.postMessage({type: "run"});
  });
  console.log(JSON.stringify({mode, stdout, result: "passed"}));
}

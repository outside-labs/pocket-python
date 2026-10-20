import {runMemoryChecks} from "./memory_checks.mjs";

self.onmessage = () => {
  try { self.postMessage({ok: true, result: runMemoryChecks()}); }
  catch (error) { self.postMessage({ok: false, error: {type: error.name, message: error.message}}); }
};

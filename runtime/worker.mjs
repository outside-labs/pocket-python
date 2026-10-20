import {execute} from "./prototype.mjs";

self.onmessage = event => {
  try {
    const value = execute(event.data.program, {maxSteps: event.data.maxSteps});
    self.postMessage({ok: true, result: {type: "int", value: value.toString()}});
  } catch (error) {
    self.postMessage({ok: false, error: {
      code: error.code || "HOST",
      message: error instanceof Error ? error.message : String(error)
    }});
  }
};

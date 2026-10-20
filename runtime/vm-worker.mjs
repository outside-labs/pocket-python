import {execute} from "./vm.mjs";

self.onmessage = event => {
  try {
    const value = execute(event.data.program, {maxSteps: event.data.maxSteps, maxWork: event.data.maxWork});
    const result = typeof value === "bigint" ? {type: "int", value: value.toString()} : {type: "bool", value};
    self.postMessage({ok: true, result});
  } catch (error) {
    self.postMessage({ok: false, error: {code: error.code || "HOST", type: error.name,
      message: error.message, instruction: error.instruction, location: error.location}});
  }
};

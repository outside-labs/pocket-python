import {InterpreterSession} from "./session.mjs";

self.onmessage = event => {
  let session = null;
  try {
    session = new InterpreterSession({memoryLimits: event.data.memoryLimits});
    const handle = session.run(event.data.program, {maxSteps: event.data.maxSteps, maxWork: event.data.maxWork});
    const result = session.read(handle);
    self.postMessage({ok: true, result});
  } catch (error) {
    self.postMessage({ok: false, error: {code: error.code || "HOST", type: error.name,
      message: error.message, instruction: error.instruction, location: error.location}});
  } finally { session?.close(); }
};

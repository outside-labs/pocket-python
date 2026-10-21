import {execute} from "./functions.mjs";
import {encodeValue} from "./values.mjs";
import {MemoryArena} from "./memory.mjs";

export function runFunctionRequest(request) {
  let memory = null, stdout = "";
  try {
    memory = new MemoryArena(request.memoryLimits);
    const value = execute(request.program, {...request.options, arena: memory,
      onOutput: text => { stdout += text; }});
    return {ok: true, stdout, result: encodeValue(value), stats: memory.stats()};
  } catch (error) {
    return {ok: false, stdout, error: {code: error.code || "HOST", type: error.name,
      message: error.message, location: error.location || null, traceback: error.traceback || [], context: error.context || null},
      stats: memory?.stats()};
  } finally { memory?.close(); }
}

import {readFile} from "node:fs/promises";
import {encodeValue} from "./values.mjs";
import {InterpreterSession} from "./session.mjs";

const engines = JSON.parse(await readFile(new URL("./engines.json", import.meta.url), "utf8"));
const engine = engines[process.argv[2]];
if (!engine) throw new Error("Unknown conformance engine.");
if (engine.input_mode !== "bytecode-fixture") throw new Error("Use the registered runner for this input profile: " + engine.runner);
const {execute} = await import(new URL(engine.module, import.meta.url));
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1_048_576) throw new Error("Conformance input exceeds 1 MiB.");
}
const requests = JSON.parse(input);
const results = requests.map(request => {
  let session = null;
  let stdout = "";
  try {
    session = ["vm2", "vm3"].includes(process.argv[2]) ? new InterpreterSession({memoryLimits: request.memoryLimits}) : null;
    const options = {maxSteps: request.maxSteps, maxWork: request.maxWork, onOutput: text => { stdout += text; }};
    const result = session ? session.read(session.run(request.program, options)) : encodeValue(execute(request.program, options));
    return {id: request.id, ok: true, result, stdout};
  } catch (error) {
    return {id: request.id, ok: false, stdout, error: {
      code: error.code || "HOST", type: error.name, message: error.message
    }};
  } finally { session?.close(); }
});
process.stdout.write(JSON.stringify({host: process.version, results}));

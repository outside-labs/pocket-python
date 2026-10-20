import {readFile} from "node:fs/promises";
import {encodeValue} from "./values.mjs";
import {InterpreterSession} from "./session.mjs";

const engines = JSON.parse(await readFile(new URL("./engines.json", import.meta.url), "utf8"));
const engine = engines[process.argv[2]];
if (!engine) throw new Error("Unknown conformance engine.");
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
  try {
    session = process.argv[2] === "vm2" ? new InterpreterSession({memoryLimits: request.memoryLimits}) : null;
    const options = {maxSteps: request.maxSteps, maxWork: request.maxWork};
    const result = session ? session.read(session.run(request.program, options)) : encodeValue(execute(request.program, options));
    return {id: request.id, ok: true, result};
  } catch (error) {
    return {id: request.id, ok: false, error: {
      code: error.code || "HOST", type: error.name, message: error.message
    }};
  } finally { session?.close(); }
});
process.stdout.write(JSON.stringify({host: process.version, results}));

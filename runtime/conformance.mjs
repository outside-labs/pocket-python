import {readFile} from "node:fs/promises";

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
  try {
    const value = execute(request.program, {maxSteps: request.maxSteps});
    let result;
    if (typeof value === "bigint") result = {type: "int", value: value.toString()};
    else if (typeof value === "boolean") result = {type: "bool", value};
    else throw new Error("Engine result has no adopted conformance encoding.");
    return {id: request.id, ok: true, result};
  } catch (error) {
    return {id: request.id, ok: false, error: {
      code: error.code || "HOST", type: error.name, message: error.message
    }};
  }
});
process.stdout.write(JSON.stringify({host: process.version, results}));

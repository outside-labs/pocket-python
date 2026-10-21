import {runFunctionRequest} from "./function-request.mjs";
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 2_097_152) throw new Error("Function conformance input exceeds 2 MiB.");
}
process.stdout.write(JSON.stringify({host: process.version,
  results: JSON.parse(raw).map(request => ({id: request.id, ...runFunctionRequest(request)}))}));

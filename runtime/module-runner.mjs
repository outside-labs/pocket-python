import {runModuleRequest} from "./module-request.mjs";
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 16_777_216) throw new Error("Module conformance input exceeds 16 MiB.");
}
const results = [];
for (const request of JSON.parse(raw)) results.push({id: request.id, ...await runModuleRequest(request)});
process.stdout.write(JSON.stringify({host: process.version, results}));

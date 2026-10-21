import {runTokenRequest} from "./source-token-request.mjs";
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 16777216) throw new Error("Source-token conformance input exceeds 16 MiB.");
}
process.stdout.write(JSON.stringify({host: process.version, results: JSON.parse(raw).map(request => ({id: request.id, ...runTokenRequest(request)}))}));

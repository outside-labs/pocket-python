import {runLibraryProfileRequest} from "./library-profile-request.mjs";
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 16777216) throw new Error("Library profile conformance input exceeds 16 MiB.");
}
const results = [];
for (const request of JSON.parse(raw)) results.push({id: request.id, ...await runLibraryProfileRequest(request)});
process.stdout.write(JSON.stringify({host: process.version, results}));

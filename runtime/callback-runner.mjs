import {runCallbackRequest} from './callback-request.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const results = [];
for (const request of JSON.parse(input)) results.push({id: request.id, ...await runCallbackRequest(request)});
process.stdout.write(JSON.stringify({host: process.version, results}) + '\n');

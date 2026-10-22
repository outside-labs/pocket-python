import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runSourceRequest} from "./source-request.mjs";
import {runExecutionRequest} from "./execution_checks.mjs";
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/interpreter/source.json", import.meta.url))).cases.find(c => c.id === "str-preserves-identity");
const modules = [{name: "app", source: fixture.source, package: false, imports: [], notice: "Synthetic identity fixture notice"}];
const closed = result => { for (const key of ["bytes", "objects", "roots", "frames", "external"]) assert.equal(result.closed[key], 0); };

test("str retains Unicode string identity through closures, aliases and instruction pauses", async () => {
  for (const languageProfile of ["core-source/1", "classes-source/1"]) {
    const request = {modules, compileOptions: {languageProfile}}, direct = await runSourceRequest(request);
    assert.equal(direct.ok, true, JSON.stringify(direct.error));
    assert.equal(direct.stdout, "True True True\nNone True 7 bad\nTrue A😀é\n"); closed(direct);
    const {boundaries, steps, work, transitions, ...stepped} = await runExecutionRequest({...request, quantum: 1});
    assert.deepEqual(stepped, direct); assert.ok(boundaries > 20); closed(stepped);
  }
});

test("interrupted string conversion releases the retained source graph", async () => {
  const result = await runSourceRequest({modules, options: {maxSteps: 35}});
  assert.equal(result.error.code, "BUDGET"); closed(result);
  const failed = await runSourceRequest({modules: [{...modules[0], source:
    's="A😀"\nheld=[]\nwhile True:\n s=str(s)\n held.append([s])\n'}],
    memoryLimits: {maxBytes: 32000}, options: {maxSteps: 100000, maxWork: 20000000}});
  assert.equal(failed.error.code, "OOM"); closed(failed);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {verifyRegistry} from "./module-registry.mjs";
import {ModuleSession} from "./module-session.mjs";
import {verifyFunctions} from "./function-bytecode.mjs";
import {execute} from "./functions.mjs";

async function registry(modules, entry = "app") {
  const {manifest, assets} = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json;sys.path.insert(0,'runtime');from module_fixtures import build_registry;data=json.load(sys.stdin);print(json.dumps(build_registry(data['modules'],data['entry'])))"],
  {input: JSON.stringify({modules, entry}), encoding: "utf8", maxBuffer: 8_388_608}));
  return verifyRegistry(manifest, new Map(Object.entries(assets).map(([name, bytes]) => [name, new Uint8Array(bytes)])));
}
const source = text => ({source: text});

test("imports share module identity, globals, default pools and builtin objects", async () => {
  const inputs = await registry({
    app: source("import helper\nimport helper as again\nfrom helper import add\nprint(helper is again, add(3), helper.str_type is str)\nanswer=add(4)"),
    helper: source("print('init')\nvalue=7\nstr_type=str\ndef add(n, amount=2):\n    return value+n+amount")
  });
  const session = new ModuleSession(inputs); let output = "";
  const first = session.run({}, text => { output += text; });
  assert.equal(output, "init\nTrue 12 True\n");
  assert.equal(session.read("answer").value, "13");
  assert.equal(session.run(), first);
  assert.equal(session.stats().frames, 0);
  session.close(); assert.equal(session.stats().bytes, 0); inputs.close();
});

test("packages initialize parents first and relative/from child imports preserve identities", async () => {
  const inputs = await registry({
    app: source("import pkg.child.worker as worker\nfrom pkg import helper\nprint(worker.answer, helper is worker.helper)"),
    pkg: {package: true, source: "print('pkg')"},
    "pkg.child": {package: true, source: "print('child')"},
    "pkg.child.worker": source("from .. import helper\nfrom ..helper import value\nanswer=value+1\nprint('worker')"),
    "pkg.helper": source("value=7\nprint('helper')")
  });
  const session = new ModuleSession(inputs); let output = "";
  session.run({}, text => { output += text; });
  assert.equal(output, "pkg\nchild\nhelper\nworker\n8 True\n");
  session.close(); inputs.close();
});

test("failed imports propagate original errors, run finally and can retry", async () => {
  const input2 = await registry({app: source("import state\ntry:\n    import bad\nexcept ValueError as error:\n    print(str(error))\nfinally:\n    print('done')\ntry:\n    import bad\nexcept ValueError:\n    print(len(state.calls))"),
    state: source("calls=[]"), bad: source("import state\nstate.calls.append(1)\nraise ValueError('bad')")});
  const session = new ModuleSession(input2); let output = "";
  session.run({}, text => { output += text; });
  assert.equal(output, "bad\ndone\n2\n");
  assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 1);
  session.close(); input2.close();
});

test("initialization cycles and undeclared imports fail explicitly without fallback", async () => {
  const cyclic = await registry({app: source("import other"), other: source("import app")});
  const session = new ModuleSession(cyclic);
  assert.throws(() => session.run(), error => error.name === "ImportError" && /Cyclic imports/.test(error.message));
  assert.equal(session.stats().roots, 1); assert.equal(session.stats().frames, 0); session.close(); cyclic.close();
  const undeclared = await registry({app: {...source("import helper"), imports: []}, helper: source("print('wrong')")});
  const denied = new ModuleSession(undeclared); let output = "";
  assert.throws(() => denied.run({}, text => { output += text; }), {name: "ImportError"});
  assert.equal(output, ""); denied.close(); undeclared.close();
});

test("session arenas are independent and import work shares one execution budget", async () => {
  const inputs = await registry({app: source("import helper\nprint(helper.value)"), helper: source("value=7")});
  for (let n = 0; n < 2; n++) {
    const session = new ModuleSession(inputs); let output = "";
    session.run({}, text => { output += text; }); assert.equal(output, "7\n"); session.close();
  }
  const bounded = new ModuleSession(inputs);
  assert.throws(() => bounded.run({maxSteps: 2}), {code: "BUDGET"});
  assert.equal(bounded.stats().frames, 0); assert.equal(bounded.stats().roots, 1); bounded.close(); inputs.close();
});

test("bounded initialization depth, cancellation and output release all transient roots", async () => {
  const modules = {};
  for (let n = 0; n < 17; n++) modules[n === 0 ? "app" : "unit" + n] = source(n === 16 ? "value=7" : "import unit" + (n + 1));
  const inputs = await registry(modules), session = new ModuleSession(inputs);
  assert.throws(() => session.run({maxWork: 20000000}), error => error.code === "BUDGET" && /depth exceeds 16/.test(error.message));
  assert.equal(session.stats().frames, 0); assert.equal(session.stats().roots, 1); session.close(); inputs.close();
  const cancelInputs = await registry({app: source("import helper\nprint('wrong')"), helper: source("while True:\n    pass")});
  const cancelled = new ModuleSession(cancelInputs); let calls = 0, output = "";
  assert.throws(() => cancelled.run({shouldCancel: () => ++calls > 80}, text => { output += text; }), {code: "CANCELLED"});
  assert.equal(output, ""); assert.equal(cancelled.stats().frames, 0); assert.equal(cancelled.stats().roots, 1);
  cancelled.close(); cancelInputs.close();
  const text = JSON.stringify("x".repeat(35000));
  const outputInputs = await registry({app: source("import helper\nprint(" + text + ")"), helper: source("print(" + text + ")")});
  const bounded = new ModuleSession(outputInputs); let count = 0;
  assert.throws(() => bounded.run({maxWork: 20000000}, value => { count += value.length; }), error => error.code === "BUDGET" && /Output budget/.test(error.message));
  assert.equal(count, 35001); assert.equal(bounded.stats().frames, 0); assert.equal(bounded.stats().roots, 1);
  bounded.close(); outputInputs.close();
});

test("host callback reentry/teardown aborts safely and sessions can retry", async () => {
  const inputs = await registry({app: source("print(1)")}), session = new ModuleSession(inputs);
  assert.throws(() => session.run({}, () => session.run()), TypeError);
  assert.equal(session.stats().frames, 0);
  assert.throws(() => session.run({}, () => session.close()), TypeError);
  assert.equal(session.stats().frames, 0);
  let output = ""; session.run({}, text => { output += text; }); assert.equal(output, "1\n");
  session.close(); assert.throws(() => session.run(), {code: "STALE_REGISTRY"}); inputs.close();
});

test("module opcodes require valid operands, stack shapes and a verified execution owner", async () => {
  const inputs = await registry({app: source("import helper"), helper: source("value=7")});
  const valid = inputs.program("app");
  assert.throws(() => execute(valid), TypeError);
  const wrongVersion = structuredClone(valid); wrongVersion.version = 3;
  assert.throws(() => verifyFunctions(wrongVersion), {code: "BYTECODE"});
  for (const instruction of [["import", "../helper", 0, true], ["import", "helper", -1, true],
    ["import", "helper", 1, true], ["import", "helper", 0, "yes"], ["module-get", "value"]]) {
    const program = structuredClone(valid), block = program.functions[0].blocks[0];
    block.instructions = [instruction, ["pop"], ["end"]]; block.source = null;
    assert.throws(() => verifyFunctions(program), {code: "BYTECODE"});
  }
  inputs.close();
});

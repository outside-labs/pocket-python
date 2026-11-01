import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {execute} from "./functions.mjs";
import {verifyFunctions} from "./function-bytecode.mjs";
import {MemoryArena} from "./memory.mjs";
import {InterpreterSession} from "./session.mjs";
import {FunctionValue} from "./function-objects.mjs";
import {encodeValue} from "./values.mjs";

function compile(source) {
  return JSON.parse(execFileSync("python3", ["-c",
    "import sys,json;sys.path.insert(0,'runtime');from function_fixtures import compile_fixture;print(json.dumps(compile_fixture(sys.stdin.read())))"],
  {input: source, encoding: "utf8"}));
}
const run = (source, options = {}) => {
  let output = "";
  const value = execute(compile(source), {...options, onOutput: text => { output += text; }});
  return {value, output};
};

test("legacy structured exception messages preserve their scalar constructor contract", () => {
  for (const name of ["SyntaxError", "IndentationError", "TabError", "UnicodeTranslateError"]) {
    const {output} = run('print(str(' + name + '("bad")),str(' + name + '(7)),str(' + name + '()))\nprint(' + name + '("direct"))\n');
    assert.equal(output, 'bad 7 \ndirect\n');
  }
});
function returning(source, name) {
  const code = compile(source), block = code.functions[0].blocks[0];
  block.instructions.splice(-1, 0, ["load", name], ["return"]);
  block.source.spans.splice(-1, 0, block.source.spans.at(-1), block.source.spans.at(-1));
  return code;
}

test("function arguments, closures, recursive calls and immutable defaults compose", () => {
  const {output} = run("def outer(n):\n    def f(a=2, *, b=3):\n        return n+a+b\n    return f\ng=outer(7)\nprint(g(), g(b=4,a=5))");
  assert.equal(output, "12 16\n");
});

test("verified functions snapshot all nested inputs and reject malformed graphs", () => {
  const input = compile("def f(value=2):\n    return value\nprint(f())");
  const verified = verifyFunctions(input);
  input.functions[1].params.defaults[0] = 99;
  input.functions[0].blocks[0].instructions[0][1] = 99;
  assert.equal(verified.code.functions[1].params.defaults[0], 0);
  assert.throws(() => { verified.code.functions[1].params.defaults[0] = 99; }, TypeError);
  const malformed = [];
  const change = mutate => { const copy = compile("if True:\n    print(1)"); mutate(copy); malformed.push(copy); };
  change(p => { p.version = 99; });
  change(p => { p.functions[0].blocks[0].instructions.push(["unknown"]); });
  change(p => { p.functions[0].blocks[0].instructions[1][1] = 0; }); // cyclic statement edge
  change(p => { p.functions[0].blocks[0].instructions[1][1] = 99; });
  change(p => { p.functions[0].blocks[0].instructions = [["pop"], ["end"]]; p.functions[0].blocks[0].source = null; });
  change(p => { p.functions[0].blocks[0].source.spans[0] = [0,1,1,1]; });
  change(p => { p.constants.push({type: "list", items: []}); });
  change(p => { p.functions[0].blocks[1].instructions = [["break"], ["end"]]; p.functions[0].blocks[1].source = null; });
  change(p => { p.functions[0].free = ["missing"]; });
  const captures = compile("def f():\n    return 1\nf()");
  captures.functions[1].free = ["missing"]; malformed.push(captures);
  for (const program of malformed) assert.throws(() => verifyFunctions(program), {code: "BYTECODE"});
});

test("bounded malformed opcode/operand mutations reject before side effects", () => {
  const source = compile("print('wrong')");
  for (let i = 0; i < 24; i++) {
    const copy = structuredClone(source);
    copy.functions[0].blocks[0].instructions.push(i % 2 ? ["invalid_" + i] : ["call", -i - 1, []]);
    copy.functions[0].blocks[0].source.spans.push([1,1,1,2]);
    let called = false;
    assert.throws(() => execute(copy, {onOutput: () => { called = true; }}), {code: "BYTECODE"});
    assert.equal(called, false);
  }
});

test("retained closures root shared cells, globals, code and recursive cycles", () => {
  const source = returning("def outer(value):\n    def inner():\n        return value\n    return inner\nresult=outer(7)", "result");
  const memory = new MemoryArena();
  const lease = execute(source, {arena: memory, retainResult: true});
  const fn = lease.get()[0];
  assert.ok(fn instanceof FunctionValue);
  assert.equal(fn.closure.get("value").value, 7n);
  assert.equal(memory.stats().frames, 0);
  assert.equal(memory.stats().roots, 1);
  const retained = memory.stats().objects;
  for (let i = 0; i < 3; i++) execute(compile("value=[]\nvalue.append(value)"), {arena: memory});
  assert.equal(memory.stats().objects, retained);
  assert.equal(fn.closure.get("value").value, 7n);
  assert.throws(() => encodeValue(fn), {name: "TypeError"});
  const foreign = new MemoryArena();
  assert.throws(() => foreign.pin([fn]), {code: "STALE_HANDLE"}); foreign.close();
  lease.release();
  assert.equal(memory.stats().objects, 0); assert.equal(memory.stats().bytes, 0); memory.close();
});

test("version 3 session handles retain closures and reject stale reads", () => {
  const session = new InterpreterSession();
  const handle = session.run(returning("def f():\n    return 1", "f"));
  assert.equal(session.stats().roots, 1);
  assert.throws(() => session.read(handle), {name: "TypeError"});
  session.release(handle);
  assert.equal(session.stats().bytes, 0);
  assert.throws(() => session.read(handle), {code: "STALE_HANDLE"}); session.close();
});

test("cancellation and resource errors bypass Python handlers and release every frame", () => {
  const source = compile("def f():\n    try:\n        while True:\n            pass\n    except BaseException:\n        print('caught')\n    finally:\n        print('finally')\nf()");
  for (const options of [{maxSteps: 12}, {maxWork: 30}, {shouldCancel: (() => { let count = 0; return () => ++count === 40; })()}]) {
    const memory = new MemoryArena(); let output = "";
    assert.throws(() => execute(source, {...options, arena: memory, onOutput: text => { output += text; }}),
      error => ["BUDGET", "CANCELLED"].includes(error.code));
    assert.equal(output, ""); assert.equal(memory.stats().frames, 0); assert.equal(memory.stats().objects, 0); memory.close();
  }
});

test("closure allocation, frame and traceback growth have deterministic bounds", () => {
  const recursive = compile("def f():\n    return f()\nf()");
  const memory = new MemoryArena({maxFrames: 5});
  assert.throws(() => execute(recursive, {arena: memory}), {name: "RecursionError"});
  assert.equal(memory.stats().frames, 0); assert.equal(memory.stats().bytes, 0); memory.close();
  let output = "";
  const source = compile("error=ValueError('bad')\nfor value in [1,2,3]:\n    try:\n        raise error\n    except ValueError:\n        print('caught')");
  execute(source, {onOutput: text => { output += text; }});
  assert.equal(output, "caught\ncaught\ncaught\n");
  assert.throws(() => run("error=ValueError('bad')\nwhile True:\n    try:\n        raise error\n    except ValueError:\n        pass", {maxSteps: 20000, maxWork: 20000000}),
    error => error.code === "BUDGET" && error.message === "Traceback frame budget exceeded.");
});

test("fixture tooling explicitly rejects deferred syntax/defaults", () => {
  for (const source of ["def f(value=[]):\n    pass", "def f(value=1+2):\n    pass", "def f(*args):\n    pass",
    "def f():\n    global x\n    x=1", "class A:\n    pass", "async def f():\n    pass"]) {
    assert.throws(() => compile(source));
  }
});

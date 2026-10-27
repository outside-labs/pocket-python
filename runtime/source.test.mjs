import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {compileSource} from "./source-compiler.mjs";
import {parseSource} from "./source-parser.mjs";
import {SourceError, tokenize} from "./source-tokens.mjs";
import {compileSourceModules} from "./source-modules.mjs";
import {runSourceRequest} from "./source-request.mjs";
import {ModuleSession} from "./module-session.mjs";
import {verifyFunctions} from "./function-bytecode.mjs";

const unit = (source, name = "app", imports = [], package_ = false) => ({name, source, imports, package: package_, notice: "Synthetic source fixture notice"});
async function run(source, options = {}) { return runSourceRequest({modules: [unit(source)], ...options}); }
const error = (source, code, options = {}) => assert.throws(() => compileSource(source, options), e => e instanceof SourceError && e.code === code);

test("comprehension lambda defaults retain deferred admission while lambda bodies keep their own scope", async () => {
  const expressions = [
    "[lambda a=(y:=7):a for x in [1]]",
    "{x:lambda a=(y:=7):a for x in [1]}",
    "{lambda a=(y:=7):a for x in [1]}",
    "(lambda a=(y:=7):a for x in [1])",
    "[lambda *,a=(y:=7):a for x in [1]]",
    "[lambda a=(lambda b=(y:=7):b):a for x in [1]]",
  ];
  for (const languageProfile of ["core-source/1", "classes-source/1"]) {
    for (const expression of expressions) {
      const result = await run("print('must not execute')\ny=9\nr="+expression+"\n", {compileOptions: {languageProfile}});
      assert.equal(result.error?.code, "UNSUPPORTED", JSON.stringify(result.error));
      assert.equal(result.stdout, ""); assert.equal(result.stats, null);
    }
    const result = await run("y=9\na=[lambda:(y:=7) for x in [1]]\nb=[lambda p=x+1:p for x in [7]]\nc=[lambda p=(lambda:(y:=8)):p for x in [1]]\nprint(y,a[0](),b[0](),c[0]()())\n", {compileOptions: {languageProfile}});
    assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal(result.stdout, "9 7 8 8\n");
    for (const key of ["bytes", "objects", "roots", "frames", "external"]) assert.equal(result.closed[key], 0);
  }
});

test("parses precedence, literal forms and frozen verified code with original UTF-8 locations", async () => {
  const source = "# original\nπ = (1 + 2 * 3)\nprint(π, -7//3, -7%3, not 0 == 1, 'a' '😀')\n";
  const compiled = compileSource(source, {filename: "logic.py"});
  assert.equal(compiled.program.version, 4); verifyFunctions(compiled.program);
  assert.ok(Object.isFrozen(compiled.program.functions[0].blocks[0].instructions));
  assert.throws(() => compiled.program.constants.push({type: "none"}), TypeError);
  const tree = parseSource(source);
  assert.deepEqual(tree.module.body[0].targets[0].span, [2, 1, 2, 3]);
  assert.deepEqual((await run(source)).stdout, "7 -3 2 True a😀\n");
});

test("binds normalized Unicode names, parameters and transitive closure cells", async () => {
  const source = "café=3\ndef outer(π,/,*,变量=2):\n    café=π+变量\n    def middle():\n        def inner(K=1):\n            return café+K\n        return inner\n    return middle\nprint(outer(4,变量=3)()(),café)\n";
  const r = await run(source); assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.stdout, "8 3\n");
  assert.equal(compileSource(source).program.functions.at(-2).free[0], "café");
  assert.equal(r.closed.bytes, 0); assert.equal(r.closed.roots, 0);
  const legacy = structuredClone(compileSource("π=1").program); legacy.version = 3;
  assert.throws(() => verifyFunctions(legacy)); // Version 3 keeps its ASCII contract.
});

test("short circuit and comparison chains evaluate operands once without temporary name collisions", async () => {
  const r = await run("events=[]\n__source_t0=99\ndef mark(n):\n    events.append(n)\n    return n\nprint(mark(3)<mark(2)<mark(9),len(events),events[0],events[1],__source_t0)\nprint(mark(1)<mark(2)<mark(3),len(events))\nprint(0 and mark(9), 1 or mark(8), 4 if True else mark(7))\n");
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.stdout, "False 2 3 2 99\nTrue 5\n0 1 4\n");
});

test("item assignment and augmented assignment preserve target/RHS order and single evaluation", async () => {
  const r = await run("events=[]\na=[10]\ndef owner():\n    events.append(1)\n    return a\ndef key():\n    events.append(2)\n    return 0\ndef rhs():\n    events.append(3)\n    return 5\nowner()[key()] = rhs()\nprint(events[0],events[1],events[2],a[0])\nevents=[]\nowner()[key()] += rhs()\nprint(events[0],events[1],events[2],a[0])\nx=a[0]=rhs()\nprint(x,a[0])\nd={'a':1}\ndel d['a']\nprint(len(d))\n");
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.stdout, "3 1 2 5\n1 2 3 10\n5 5\n0\n");
});

test("bound list append owns its receiver and module append exports keep ordinary dispatch", async () => {
  const modules = [unit("def make():\n    values=[]\n    def count():\n        return len(values)\n    return values.append,count\npair=make()\npair[0](7)\nprint(pair[1]())\nimport helper\nprint(helper.append(8))\n", "app", ["helper"]), unit("def append(value):\n    return value+1\n", "helper")];
  const r = await runSourceRequest({modules}); assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.stdout, "1\n9\n"); assert.equal(r.closed.bytes, 0); assert.equal(r.closed.objects, 0);
});

test("augmented lists retain aliases and self-extension/multiplication semantics", async () => {
  const r = await run("a=[1]\nb=a\na+=a\nprint(a is b,len(b),b[0],b[1])\na*=2\nprint(a is b,len(b))\na+=(3,4)\na+='😀'\na+={'x':1}\nprint(len(a),a[-2],a[-1])\na*=0\nprint(a is b,len(b))\nx=[[1]]\nchild=x[0]\nx[0]+=[2]\nprint(child is x[0],len(child))\n");
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.stdout, "True 2 1 1\nTrue 4\n8 😀 x\nTrue 0\nTrue 2\n");
  assert.equal(r.closed.bytes, 0);
});

test("syntax and feature diagnostics reject complete source before application effects", async () => {
  for (const source of ["return 1", "break", "continue", "if True print(1)", "def f(:\n pass", "x=(1+)", "f(a=1,a=2)", "f(a=1,2)", "try:\n pass\n", "def f(a=1,b):\n pass", "def f(*):\n pass", "def f(a,a):\n pass", "None=1", "import *"]) error(source, "SYNTAX");
  for (const source of ["class C: pass", "async def f(): pass", "x=[(n:=1) for n in []]", "x=2@3", "from x import *", "x:int=1", "def f(a:int): pass", "raise ValueError() from None", "'\\N{SNOWMAN}'"]) {
    error(source, "UNSUPPORTED");
  }
  const r = await run("print('must not execute')\nclass Deferred: pass\n");
  assert.equal(r.ok, false); assert.equal(r.stdout, ""); assert.equal(r.error.code, "UNSUPPORTED"); assert.equal(r.stats, null);
});

test("source work/tree/instruction budgets and cancellation fail with structured diagnostics", async () => {
  const source = "def f(x):\n    return x+1\nprint(f(2))\n", scanned = tokenize(source);
  error(source, "COMPILE_BUDGET", {maxWork: scanned.stats.work});
  error(source, "COMPILE_BUDGET", {maxNodes: 2}); error(source, "COMPILE_BUDGET", {maxParseDepth: 2});
  error(source, "CANCELLED", {shouldCancel: () => true});
  error("x=1\n".repeat(2200), "COMPILE_BUDGET");
  const r = await run("while True:\n    pass\n", {options: {maxSteps: 50}});
  assert.equal(r.error.code, "BUDGET"); assert.equal(r.closed.bytes, 0); assert.equal(r.stats.frames, 0);
  const modules = [unit("pass", "app"), unit("pass", "other")];
  const work = compileSource("pass", {filename: "sources/app.py"}).stats.work;
  await assert.rejects(compileSourceModules(modules, {maxWork: work + 1}), e => e.code === "COMPILE_BUDGET");
});

test("explicit registries snapshot source bytes and grants before asynchronous verification", async () => {
  const original = new TextEncoder().encode("print(7)\n"), bytes = Buffer.from(original), input = [unit(bytes)];
  const pending = compileSourceModules(input); bytes.fill(33); input[0].name = "changed"; input[0].imports.push("missing"); input[0].source = "print(9)";
  const {registry, compilations} = await pending;
  const session = new ModuleSession(registry); let stdout = "";
  try {
    session.run({}, text => { stdout += text; }); assert.equal(stdout, "7\n");
    assert.deepEqual(registry.asset(registry.record("app").source.path), original);
    assert.ok(Object.isFrozen(compilations[0].source));
  } finally { session.close(); registry.close(); }
  const empty = await run(""); assert.equal(empty.ok, true); assert.equal(empty.compilation[0].source.size_bytes, 0);
  const denied = await runSourceRequest({modules: [unit("import helper\n"), unit("print('never')", "helper")]});
  assert.equal(denied.ok, false); assert.equal(denied.error.type, "ImportError"); assert.equal(denied.stdout, "");
});

test("prototype-like names and keyword defaults stay ordinary Python bindings", async () => {
  const r = await run("__proto__=5\nconstructor=6\ndef f(*,__proto__=7,constructor=8):\n    return __proto__+constructor\nprint(__proto__,constructor,f(),f(__proto__=1,constructor=2))\n");
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.stdout, "5 6 15 3\n");
});

test("compiler temporaries cannot become Python module attributes after a caught error", async () => {
  const modules = [unit("import helper\ntry:\n    print(helper.__source_t0)\nexcept AttributeError:\n    print('private')\n", "app", ["helper"]),
    unit("try:\n    1 < 'bad' < 3\nexcept TypeError:\n    pass\n", "helper")];
  const r = await runSourceRequest({modules}); assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.stdout, "private\n");
  const code = structuredClone(compileSource("1<2<3").program);
  code.functions[0].blocks[0].instructions.unshift(["load", "@source:999"]);
  code.functions[0].blocks[0].source.spans.unshift([1, 1, 1, 1]);
  assert.throws(() => verifyFunctions(code));
});

test("seeded source mutations produce verified programs or explicit source diagnostics", () => {
  const original = "def f(a,/,b=2):\n    if a<b:\n        return a+1\n    return b\nprint(f(3))\n", chars = [" ", "\n", "'", "\t", "_", ":", "(", ")", "=", "π", "1", "+"];
  let seed = 27817;
  const random = high => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % high; };
  for (let trial = 0; trial < 500; trial++) {
    let source = original;
    for (let i = 0; i < 3; i++) { const at = random(source.length); source = source.slice(0, at) + chars[random(chars.length)] + source.slice(at + random(2)); }
    try { verifyFunctions(compileSource(source, {maxWork: 20000}).program); }
    catch (e) { assert.ok(e instanceof SourceError, e.stack); }
  }
});


test("recognized deferred forms validate syntax, UTF-8 spans and profile boundaries before execution", async () => {
  const corpus = JSON.parse(readFileSync(new URL("../tests/fixtures/interpreter/source.json", import.meta.url)));
  const cases = [...corpus.boundaries.filter(c => c.span), ...corpus.malformed_source.filter(c => c.id.startsWith("syntax-new-forms-"))];
  for (const item of cases) {
    const result = await run(item.source, {compileOptions: item.compileOptions});
    assert.equal(result.error.code, item.code, item.id);
    assert.equal(result.error.phase, "parse", item.id);
    if (item.span) assert.deepEqual(result.error.location.span, item.span, item.id);
    assert.equal(result.stdout, ""); assert.equal(result.compilation, null); assert.equal(result.stats, null);
  }
  error("print((x:=7))", "COMPILE_BUDGET", {maxNodes: 2});
  error("type A[T] = list[T]", "COMPILE_BUDGET", {maxWork: tokenize("type A[T] = list[T]").stats.work});
});

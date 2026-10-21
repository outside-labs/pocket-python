import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {libraryProfile, hostProfile, verifyLibraries, compileProfileSource} from "./library-profiles.mjs";
import {ModuleSession} from "./module-session.mjs";

const text = async name => (await readFile(new URL(name, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const supplied = async () => [{name: "operator", package: false, imports: [],
  source: await text("library/operator.py"), notice: await text("licenses/POCKET-PYTHON.txt")}];
async function run(source, options = {}) {
  const {registry, library} = await compileProfileSource(source, options);
  const session = new ModuleSession(registry); let stdout = "";
  try { session.run({maxSteps: 50000, maxWork: 20000000}, value => { stdout += value; }); return {stdout, library}; }
  finally { session.close(); registry.close(); assert.equal(session.stats().bytes, 0); assert.equal(session.stats().roots, 0); }
}

test("full and reduced library selections preserve common core computation", async () => {
  const libraries = await supplied();
  const source = "def count(text):\n    value=0\n    for char in text:\n        value+=1\n    return value\nprint(count('A😀 é'),9007199254740993+1)\n";
  const core = await run(source), full = await run(source, {profile: "operator/1", libraries});
  assert.equal(core.stdout, "5 9007199254740994\n"); assert.equal(full.stdout, core.stdout);
  assert.deepEqual(core.library.modules, []); assert.deepEqual(full.library.modules, ["operator"]);
  assert.notEqual(core.library.fingerprint, full.library.fingerprint);
  assert.ok(Object.isFrozen(libraryProfile("operator/1").modules[0].imports));
});

test("the selected operator source is ordinary verified Python with explicit grants", async () => {
  const libraries = await supplied();
  const result = await run("import operator\nprint(operator.add(9007199254740993,1),operator.floordiv(-7,3),operator.getitem([4,5],1),operator.truth([]))\n", {profile: "operator/1", libraries});
  assert.equal(result.stdout, "9007199254740994 -3 5 False\n");
  await assert.rejects(run("import operator\n"), error => error.name === "ImportError");
  await assert.rejects(run("import browser\n", {profile: "operator/1", libraries}), error => error.name === "ImportError");
  await assert.rejects(run("import operator\noperator.truediv(1,2)\n", {profile: "operator/1", libraries}), error => error.name === "AttributeError");
});

test("missing/extra/changed modules, import grants and notices fail before execution", async () => {
  await assert.rejects(verifyLibraries("operator/1", []), error => error.code === "LIBRARY_PROFILE");
  await assert.rejects(verifyLibraries("core-only/1", await supplied()), error => error.code === "LIBRARY_PROFILE");
  for (const change of [{source: "print('wrong')"}, {notice: "changed"}, {name: "os"}, {imports: ["os"]}, {package: true}]) {
    const libraries = await supplied(); Object.assign(libraries[0], change);
    await assert.rejects(verifyLibraries("operator/1", libraries), error => ["LIBRARY_PROFILE", "LIBRARY_INTEGRITY"].includes(error.code));
  }
  assert.throws(() => libraryProfile("__proto__"), error => error.code === "LIBRARY_PROFILE");
  assert.throws(() => hostProfile("fetch/1"), error => error.code === "UNAVAILABLE");
  assert.deepEqual(hostProfile().capabilities, [{id: "output/1"}]);
});

test("selection, source bytes and grants are snapshotted across hashing", async () => {
  const libraries = await supplied(), bytes = Buffer.from("import operator\nprint(operator.add(2,3))\n");
  const pending = compileProfileSource(bytes, {profile: "operator/1", libraries});
  bytes.fill(33); libraries[0].source = "changed"; libraries[0].imports.push("os");
  const {registry} = await pending, session = new ModuleSession(registry); let stdout = "";
  try { session.run({}, text => { stdout += text; }); assert.equal(stdout, "5\n"); }
  finally { session.close(); registry.close(); }
  await assert.rejects(compileProfileSource("pass", {profile: "operator/1", libraries: await supplied(), maxWork: 1}), error => error.code === "COMPILE_BUDGET");
  await assert.rejects(compileProfileSource("pass", {profile: "operator/1", libraries: await supplied(), shouldCancel: () => true}), error => error.code === "CANCELLED");
});

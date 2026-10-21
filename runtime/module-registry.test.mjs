import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {verifyRegistry, VerifiedRegistry} from "./module-registry.mjs";
import {execute} from "./functions.mjs";
const encode = value => new TextEncoder().encode(value);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const unit = {format: "pocket-python-bytecode", version: 3, constants: [{type: "int", value: "7"}],
    functions: [{name: "<module>", qualname: "<module>", params: {posonly: [], positional: [], kwonly: [], defaults: [], kwdefaults: {}},
      locals: [], free: [], body: 0, blocks: [{kind: "statement", instructions: [["const", 0], ["return"]],
        source: {filename: "fixture.py", spans: [[1,1,1,2],[1,1,1,2]]}}]}]};
  const assets = new Map();
  const asset = (path, bytes) => {
    assets.set(path, bytes);
    return {path, size_bytes: bytes.length, sha256: digest(bytes)};
  };
  const notice = asset("LICENSES/project.txt", encode("Synthetic fixture license\n"));
  const modules = ["app", "pkg", "pkg.helper", "pkg.child", "pkg.child.worker"].map(name => ({
    name, package: ["pkg", "pkg.child"].includes(name),
    bytecode: asset("code/" + name.replaceAll(".", "/") + ".pbc.json", encode(JSON.stringify(unit))),
    source: asset("sources/" + name.replaceAll(".", "/") + ".py", encode("value = 7\n")),
    imports: name === "app" ? ["pkg.helper", "pkg.child.worker"] : name === "pkg.child.worker" ? ["pkg.helper", "pkg.child"] : [],
    licenses: [notice]
  }));
  return {manifest: {kind: "pocket-python-module-registry", schema_version: 1, entry: "app", roots: ["code", "sources"], modules}, assets};
}
const make = async () => { const input = fixture(); return {...input, registry: await verifyRegistry(input.manifest, input.assets)}; };
function rewrite(input, transform) {
  const descriptor = input.manifest.modules[0].bytecode;
  const program = JSON.parse(new TextDecoder().decode(input.assets.get(descriptor.path)));
  transform(program);
  const bytes = encode(JSON.stringify(program)); input.assets.set(descriptor.path, bytes);
  descriptor.sha256 = digest(bytes); descriptor.size_bytes = bytes.length;
}

test("verified closed registries preserve module/code/notice identities", async () => {
  const {registry, manifest, assets} = await make();
  assert.ok(registry instanceof VerifiedRegistry);
  assert.equal(registry.entry, "app");
  assert.deepEqual(registry.names, ["app", "pkg", "pkg.child", "pkg.child.worker", "pkg.helper"]);
  assert.equal(registry.sizeBytes, [...assets.values()].reduce((total, bytes) => total + bytes.length, 0));
  assert.equal(registry.record("app").bytecode.sha256, manifest.modules[0].bytecode.sha256);
  assert.equal(registry.record("app"), registry.record("app"));
  assert.equal(registry.program("app"), registry.program("app"));
  assert.equal(execute(registry.program("app")), 7n);
  assert.throws(() => { registry.program("app").constants[0].value = "9"; }, TypeError);
  assert.throws(() => { registry.record("app").imports.push("os"); }, TypeError);
  assert.throws(() => new VerifiedRegistry(), TypeError);
});

test("absolute and relative resolution honors explicit grants and package roots", async () => {
  const {registry} = await make();
  assert.equal(registry.resolve("app", "pkg.helper"), "pkg.helper");
  assert.equal(registry.resolve("pkg.child.worker", "helper", 2), "pkg.helper");
  assert.equal(registry.resolve("pkg.child.worker", "", 1), "pkg.child");
  assert.deepEqual(registry.parents("pkg.child.worker"), ["pkg", "pkg.child"]);
  for (const args of [["app", "helper", 1], ["pkg.child.worker", "helper", 3], ["app", "os"],
    ["app", "pkg", 0], ["app", "../helper", 0], ["app", "pkg.helper", -1]]) {
    assert.throws(() => registry.resolve(...args), {code: "IMPORT"});
  }
  assert.throws(() => registry.program("os"), {name: "ModuleNotFoundError", code: "IMPORT"});
  assert.throws(() => registry.asset("server/private.py"), {code: "REGISTRY"});
});

test("manifest and Uint8Array/Buffer inputs are snapshotted before asynchronous hashes", async () => {
  const input = fixture(), original = structuredClone(input.manifest.modules[0].bytecode);
  const filename = original.path, buffer = Buffer.from(input.assets.get(filename)); input.assets.set(filename, buffer);
  const pending = verifyRegistry(input.manifest, input.assets);
  buffer.fill(0); input.manifest.entry = "missing"; input.manifest.modules[0].name = "different";
  input.manifest.modules[0].imports.push("os"); input.assets.clear();
  const registry = await pending;
  assert.equal(registry.entry, "app");
  assert.equal(digest(registry.asset(filename)), original.sha256);
  const returned = registry.asset(filename); returned.fill(0);
  assert.equal(digest(registry.asset(filename)), original.sha256);
  assert.equal(execute(registry.program("app")), 7n);
});

test("missing/extra/tampered assets, conflicting roles and missing notices reject", async () => {
  const mutations = [
    input => input.assets.delete(input.manifest.modules[0].bytecode.path),
    input => input.assets.set("server/private.py", encode("synthetic canary")),
    input => { input.assets.get(input.manifest.modules[0].bytecode.path)[0] ^= 1; },
    input => { input.manifest.modules[0].bytecode.size_bytes++; },
    input => { input.manifest.modules[0].licenses = []; },
    input => { input.assets.delete("LICENSES/project.txt"); },
    input => { input.manifest.modules[0].source = input.manifest.modules[0].bytecode; },
    input => { input.manifest.modules[1].licenses[0] = {...input.manifest.modules[1].licenses[0], sha256: "0".repeat(64)}; },
  ];
  for (const mutation of mutations) { const input = fixture(); mutation(input); await assert.rejects(verifyRegistry(input.manifest, input.assets), {code: "REGISTRY"}); }
});

test("names, dependency closure, safe paths, roots and package parents are verified", async () => {
  const mutations = [
    input => { input.manifest.schema_version = 2; },
    input => { input.manifest.modules[0].name = "../app"; },
    input => { input.manifest.modules[1].name = "app"; },
    input => { input.manifest.modules[0].imports.push("os"); },
    input => { input.manifest.modules[1].package = false; },
    input => { input.manifest.roots = ["code", "code/child", "sources"]; },
    input => { input.manifest.roots = ["elsewhere"]; },
    input => { input.manifest.modules[0].bytecode.path = "code/../app.json"; },
    input => { input.manifest.modules[0].bytecode.path = "https://example.test/app.json"; },
    input => { input.manifest.modules[0].bytecode.path = "code/%2e%2e/app.json"; },
    input => { input.manifest.modules[0].bytecode.path = "code\\app.json"; },
  ];
  for (const mutation of mutations) { const input = fixture(); mutation(input); await assert.rejects(verifyRegistry(input.manifest, input.assets), {code: "REGISTRY"}); }
});

test("bytecode, UTF-8 provenance and bounded inputs reject before execution", async () => {
  const malformed = fixture(); rewrite(malformed, p => p.functions[0].blocks[0].instructions.push(["unknown"]));
  await assert.rejects(verifyRegistry(malformed.manifest, malformed.assets), {code: "BYTECODE"});
  const invalidText = fixture(), source = invalidText.manifest.modules[0].source;
  invalidText.assets.set(source.path, new Uint8Array([255])); source.size_bytes = 1; source.sha256 = digest(new Uint8Array([255]));
  await assert.rejects(verifyRegistry(invalidText.manifest, invalidText.assets), {code: "REGISTRY"});
  const tooMany = fixture(); tooMany.manifest.modules = Array(65).fill(tooMany.manifest.modules[0]);
  await assert.rejects(verifyRegistry(tooMany.manifest, tooMany.assets), {code: "REGISTRY"});
  const tooLarge = fixture(); tooLarge.manifest.modules[0].bytecode.size_bytes = 1_048_577;
  await assert.rejects(verifyRegistry(tooLarge.manifest, tooLarge.assets), {code: "REGISTRY"});
  const extras = fixture(); rewrite(extras, p => { p.functions[0].blocks[0].source.ignored = {deep: [1,2]}; });
  const registry = await verifyRegistry(extras.manifest, extras.assets);
  assert.equal(Object.hasOwn(registry.program("app").functions[0].blocks[0].source, "ignored"), false);
});

test("closing registries drops assets and rejects every subsequent lookup", async () => {
  const {registry} = await make(); registry.close(); registry.close();
  for (const read of [() => registry.entry, () => registry.names, () => registry.sizeBytes,
    () => registry.record("app"), () => registry.program("app"), () => registry.asset("LICENSES/project.txt"),
    () => registry.parents("app"), () => registry.resolve("app", "pkg.helper")]) assert.throws(read, {code: "STALE_REGISTRY"});
});

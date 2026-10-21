import {verifyFunctions} from "./function-bytecode.mjs";

export const REGISTRY_LIMITS = Object.freeze({modules: 64, files: 256, roots: 16,
  totalBytes: 16_777_216, bytecodeBytes: 1_048_576, sourceBytes: 262_144, noticeBytes: 65_536});
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const moduleName = value => typeof value === "string" && value.length <= 192 &&
  /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*$/.test(value);
const states = new WeakMap();
const token = {};

export class RegistryError extends Error {
  constructor(message, name = "RegistryError", code = "REGISTRY") {
    super(message); this.name = name; this.code = code;
  }
}
const fail = message => { throw new RegistryError(message); };
const importError = (message, name = "ImportError") => { throw new RegistryError(message, name, "IMPORT"); };
function fields(value, names) {
  if (!object(value) || Object.keys(value).length !== names.length || !names.every(key => own(value, key))) fail("Invalid registry record fields.");
}
function path(value) {
  if (typeof value !== "string" || !value || value.length > 256 || !/^[A-Za-z_0-9./-]+$/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === "..") || value.startsWith("/")) fail("Registry paths must be safe relative paths.");
  return value;
}
function descriptor(value, maximum, allowEmpty = false) {
  fields(value, ["path", "size_bytes", "sha256"]);
  if (!Number.isSafeInteger(value.size_bytes) || value.size_bytes < (allowEmpty ? 0 : 1) || value.size_bytes > maximum ||
      typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) fail("Invalid asset size or SHA-256.");
  return Object.freeze({path: path(value.path), size_bytes: value.size_bytes, sha256: value.sha256});
}
function freezeJSON(value) {
  // JSON bytecode has already passed the bounded structural/value verifier.
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeJSON(item);
    Object.freeze(value);
  }
  return value;
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
function state(registry) {
  const result = states.get(registry);
  if (!result || result.closed) throw new RegistryError("Registry is closed or unverified.", "ReferenceError", "STALE_REGISTRY");
  return result;
}

export class VerifiedRegistry {
  constructor(key, data) {
    if (key !== token) throw new TypeError("Use verifyRegistry to construct a verified registry.");
    states.set(this, data); Object.freeze(this);
  }
  get entry() { return state(this).entry; }
  get names() { return state(this).names; }
  get sizeBytes() { return state(this).sizeBytes; }
  record(name) {
    const entry = state(this).records.get(name);
    if (!entry) importError("Module is outside the verified registry: " + name, "ModuleNotFoundError");
    return entry.record;
  }
  program(name) { this.record(name); return state(this).records.get(name).program; }
  asset(filename) {
    const bytes = state(this).assets.get(filename);
    if (!bytes) throw new RegistryError("Asset is outside the verified closure: " + filename);
    return bytes.slice();
  }
  parents(name) {
    this.record(name);
    const parts = name.split("."), result = [];
    for (let size = 1; size < parts.length; size++) result.push(parts.slice(0, size).join("."));
    return Object.freeze(result);
  }
  resolve(importer, specifier, level = 0) {
    const caller = this.record(importer);
    if ((!moduleName(specifier) && specifier !== "") || !Number.isSafeInteger(level) || level < 0 || level > 32 ||
        (!specifier && level === 0)) importError("Invalid static import request.");
    let target = specifier;
    if (level) {
      const parts = (caller.package ? caller.name : caller.name.split(".").slice(0, -1).join(".")).split(".").filter(Boolean);
      if (!parts.length) importError("attempted relative import with no known parent package");
      if (level > parts.length) importError("attempted relative import beyond top-level package");
      target = [...parts.slice(0, parts.length - level + 1), ...(specifier ? specifier.split(".") : [])].join(".");
    }
    if (!caller.imports.includes(target)) importError("Import is not declared for " + importer + ": " + target);
    this.record(target); return target;
  }
  close() {
    const data = states.get(this);
    if (!data || data.closed) return;
    data.closed = true; data.assets.clear(); data.records.clear();
  }
}

export async function verifyRegistry(manifest, suppliedAssets) {
  fields(manifest, ["kind", "schema_version", "entry", "roots", "modules"]);
  if (manifest.kind !== "pocket-python-module-registry" || manifest.schema_version !== 1 || !moduleName(manifest.entry)) fail("Unknown registry identity or entry name.");
  if (!Array.isArray(manifest.roots) || !manifest.roots.length || manifest.roots.length > REGISTRY_LIMITS.roots ||
      !Array.from(manifest.roots).every(root => typeof root === "string")) fail("Invalid module roots.");
  const roots = manifest.roots.map(path);
  if (new Set(roots).size !== roots.length || roots.some(a => roots.some(b => a !== b && a.startsWith(b + "/")))) fail("Module roots must be distinct and non-overlapping.");
  if (!Array.isArray(manifest.modules) || !manifest.modules.length || manifest.modules.length > REGISTRY_LIMITS.modules) fail("Invalid module count.");
  if (!(suppliedAssets instanceof Map) || suppliedAssets.size > REGISTRY_LIMITS.files) fail("Assets require a bounded path-to-byte Map.");
  const assets = new Map(), descriptors = new Map(), records = new Map();
  const declare = (value, role, maximum) => {
    const item = descriptor(value, maximum, role === "source"), previous = descriptors.get(item.path);
    if (previous && (role !== "notice" || previous.role !== "notice" || previous.item.sha256 !== item.sha256 ||
        previous.item.size_bytes !== item.size_bytes)) fail("Conflicting asset identities or roles.");
    descriptors.set(item.path, {item, role});
    if (role !== "notice" && !roots.some(root => item.path.startsWith(root + "/"))) fail("Executable/source asset is outside declared module roots.");
    return item;
  };
  // Snapshot all caller-owned records and bytes before the first asynchronous hash.
  for (const input of manifest.modules) {
    fields(input, ["name", "package", "bytecode", "source", "imports", "licenses"]);
    if (!moduleName(input.name) || records.has(input.name) || typeof input.package !== "boolean" ||
        !Array.isArray(input.imports) || input.imports.length > REGISTRY_LIMITS.modules ||
        !Array.from(input.imports).every(moduleName) || new Set(input.imports).size !== input.imports.length ||
        !Array.isArray(input.licenses) || !input.licenses.length || input.licenses.length > 16) fail("Invalid module identity, imports or licenses.");
    const record = Object.freeze({name: input.name, package: input.package,
      bytecode: declare(input.bytecode, "bytecode", REGISTRY_LIMITS.bytecodeBytes),
      source: input.source === null ? null : declare(input.source, "source", REGISTRY_LIMITS.sourceBytes),
      imports: Object.freeze([...input.imports]), licenses: Object.freeze(input.licenses.map(item => declare(item, "notice", REGISTRY_LIMITS.noticeBytes)))});
    records.set(record.name, {record, program: null});
  }
  const entry = manifest.entry;
  if (!records.has(entry)) fail("Entry module is not declared.");
  for (const {record} of records.values()) {
    for (const dependency of record.imports) if (!records.has(dependency)) fail("Declared import is outside the registry: " + dependency);
    const parts = record.name.split(".");
    for (let size = 1; size < parts.length; size++) if (!records.get(parts.slice(0, size).join("."))?.record.package) fail("Every dotted module requires declared package parents.");
  }
  if (descriptors.size !== suppliedAssets.size || descriptors.size > REGISTRY_LIMITS.files) fail("Supplied assets must exactly match the declared closure.");
  let sizeBytes = 0;
  for (const [filename, {item}] of descriptors) {
    const bytes = suppliedAssets.get(filename);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== item.size_bytes || (sizeBytes += bytes.byteLength) > REGISTRY_LIMITS.totalBytes) fail("Missing, oversized or incorrectly sized asset: " + filename);
    // slice() on Node Buffer aliases; the Uint8Array constructor always copies.
    assets.set(filename, new Uint8Array(bytes));
  }
  for (const [filename, {item}] of descriptors) if (await sha256(assets.get(filename)) !== item.sha256) fail("Asset hash mismatch: " + filename);
  for (const value of records.values()) {
    let program;
    try { program = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(assets.get(value.record.bytecode.path))); }
    catch { fail("Bytecode asset is not valid UTF-8 JSON: " + value.record.bytecode.path); }
    const checked = verifyFunctions(program).code;
    value.program = freezeJSON({format: checked.format, version: checked.version, constants: program.constants,
      functions: checked.functions.map(fn => ({name: fn.name, qualname: fn.qualname, params: fn.params,
        locals: fn.locals, free: fn.free, body: fn.body,
        blocks: fn.blocks.map(block => ({kind: block.kind, instructions: block.instructions, source: block.source}))}))});
    if (value.record.source) {
      try { new TextDecoder("utf-8", {fatal: true}).decode(assets.get(value.record.source.path)); }
      catch { fail("Source provenance is not valid UTF-8: " + value.record.source.path); }
    }
  }
  return new VerifiedRegistry(token, {entry, records, assets, sizeBytes,
    names: Object.freeze([...records.keys()].sort()), closed: false});
}

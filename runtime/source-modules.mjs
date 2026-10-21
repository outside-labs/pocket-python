import {compileSource} from "./source-compiler.mjs";
import {SourceError, SOURCE_LIMITS} from "./source-tokens.mjs";
import {verifyRegistry, REGISTRY_LIMITS} from "./module-registry.mjs";

const encoder = new TextEncoder();
const moduleName = value => typeof value === "string" && value.length <= 192 && /^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*$/.test(value);
const failure = (message, code = "UNSUPPORTED") => { throw new SourceError(code, message, {filename: "<registry>", phase: "registry"}); };
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");

export async function compileSourceModules(input, {entry = "app", ...options} = {}) {
  if (!Array.isArray(input) || input.length < 1 || input.length > REGISTRY_LIMITS.modules || !moduleName(entry)) failure("Expected bounded explicit source modules and entry identity.");
  const names = new Set();
  // Snapshot every caller-owned record, grant and byte view before any await.
  const modules = Array.from(input, item => {
    if (item === null || typeof item !== "object" || !moduleName(item.name) || names.has(item.name) ||
        typeof item.package !== "boolean" || !Array.isArray(item.imports) || item.imports.length > REGISTRY_LIMITS.modules ||
        !Array.from(item.imports).every(moduleName) || new Set(item.imports).size !== item.imports.length ||
        typeof item.notice !== "string" || !item.notice.trim() || item.notice.length > REGISTRY_LIMITS.noticeBytes ||
        !(typeof item.source === "string" || item.source instanceof Uint8Array)) failure("Invalid source module, import grant or provenance notice.");
    names.add(item.name);
    if (item.source.length > REGISTRY_LIMITS.sourceBytes) failure("Source module byte budget exceeded.", "COMPILE_BUDGET");
    return {name: item.name, package: item.package, imports: [...item.imports], notice: item.notice,
      source: typeof item.source === "string" ? item.source : new Uint8Array(item.source)};
  });
  if (!names.has(entry)) failure("Entry module is not supplied.");
  for (const item of modules) {
    if (item.imports.some(name => !names.has(name))) failure("An import grant names a module outside the supplied registry.");
    const parts = item.name.split(".");
    for (let size = 1; size < parts.length; size++) if (!modules.find(parent => parent.name === parts.slice(0, size).join("."))?.package) failure("Dotted source modules require explicit package parents.");
  }
  const assets = new Map(), records = [], compilations = [];
  let bytes = 0;
  const asset = async (path, content, maximum, allowEmpty = false) => {
    if ((!content.byteLength && !allowEmpty) || content.byteLength > maximum) failure("Source/bytecode/notice asset budget exceeded.", "COMPILE_BUDGET");
    if (!assets.has(path)) {
      if ((bytes += content.byteLength) > REGISTRY_LIMITS.totalBytes) failure("Source registry byte budget exceeded.", "COMPILE_BUDGET");
      assets.set(path, content);
    }
    return Object.freeze({path, size_bytes: content.byteLength, sha256: await hash(content)});
  };
  // Compile the complete selected registry before any application can execute.
  let workLeft = options.maxWork ?? SOURCE_LIMITS.work, totalBytes = 0;
  const compiled = modules.map(item => {
    const filename = "sources/" + item.name.replaceAll(".", "/") + (item.package ? "/__init__.py" : ".py");
    if (workLeft < 1) failure("Registry compilation work budget exceeded.", "COMPILE_BUDGET");
    const result = compileSource(item.source, {...options, filename, maxWork: workLeft});
    workLeft -= result.stats.work;
    totalBytes += result.stats.bytes + result.stats.bytecodeBytes + encoder.encode(item.notice).byteLength;
    if (totalBytes > REGISTRY_LIMITS.totalBytes) failure("Registry compilation byte budget exceeded.", "COMPILE_BUDGET");
    return {...item, filename, result};
  });
  for (const item of compiled) {
    const sourceBytes = typeof item.source === "string" ? encoder.encode(item.source) : item.source;
    const noticeBytes = encoder.encode(item.notice), noticeHash = await hash(noticeBytes);
    const notice = await asset("LICENSES/" + noticeHash + ".txt", noticeBytes, REGISTRY_LIMITS.noticeBytes);
    const source = await asset(item.filename, sourceBytes, REGISTRY_LIMITS.sourceBytes, true);
    const bytecode = await asset("code/" + item.name.replaceAll(".", "/") + ".pbc.json", encoder.encode(JSON.stringify(item.result.program)), REGISTRY_LIMITS.bytecodeBytes);
    records.push({name: item.name, package: item.package, imports: item.imports, licenses: [notice], source, bytecode});
    compilations.push(Object.freeze({module: item.name, source, bytecode, language_profile: item.result.languageProfile, stats: item.result.stats}));
  }
  const registry = await verifyRegistry({kind: "pocket-python-module-registry", schema_version: 1,
    entry, roots: ["sources", "code"], modules: records}, assets);
  return Object.freeze({registry, compilations: Object.freeze(compilations), languageProfile: options.languageProfile ?? "core-source/1"});
}

import {LIBRARY_CATALOG} from "./library-catalog.mjs";

const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
freeze(LIBRARY_CATALOG);
const encoder = new TextEncoder();
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))), b => b.toString(16).padStart(2, "0")).join("");
export class LibraryProfileError extends Error {
  constructor(message, code = "LIBRARY_PROFILE") { super(message); this.name = "LibraryProfileError"; this.code = code; }
}
const fail = (message, code) => { throw new LibraryProfileError(message, code); };
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function libraryProfile(id) {
  if (typeof id !== "string" || !Object.hasOwn(LIBRARY_CATALOG, id)) fail("Unknown library profile; no fallback is selected.");
  return LIBRARY_CATALOG[id];
}
export function hostProfile(id = "output-only/1") {
  if (id !== "output-only/1") fail("The requested host-module profile is unavailable; async adapters require INT-10.", "UNAVAILABLE");
  return freeze({id, capabilities: [{id: "output/1"}], modules: []});
}
export function snapshotLibraries(id, input) {
  const profile = libraryProfile(id);
  if (!Array.isArray(input) || input.length !== profile.modules.length) fail("Library module selection differs from the declared profile.");
  const records = input.map((item, index) => {
    const expected = profile.modules[index];
    if (!exact(item, ["name", "package", "imports", "source", "notice"]) || item.name !== expected.name || item.package !== expected.package ||
        !Array.isArray(item.imports) || item.imports.length !== expected.imports.length || !item.imports.every((name, i) => name === expected.imports[i]) ||
        typeof item.source !== "string" || item.source.length > expected.source.size_bytes ||
        typeof item.notice !== "string" || item.notice.length > expected.notice.size_bytes) fail("Library identity, import grants or bounded source/notice differs.");
    return freeze({name: item.name, package: item.package, imports: [...item.imports], source: item.source, notice: item.notice});
  });
  return freeze(records);
}
export async function verifyLibraries(id, input) {
  const profile = libraryProfile(id), records = snapshotLibraries(id, input);
  // Copy every record before the first await; strings and the returned graph
  // remain immutable while browser/Node hashing completes.
  for (let index = 0; index < records.length; index++) {
    for (const key of ["source", "notice"]) {
      if (encoder.encode(records[index][key]).byteLength !== profile.modules[index][key].size_bytes ||
          await digest(records[index][key]) !== profile.modules[index][key].sha256) fail("Library " + key + " differs from its reviewed identity.", "LIBRARY_INTEGRITY");
    }
  }
  return freeze({id, fingerprint: profile.fingerprint, modules: records});
}
export function profileModules(source, selection) {
  return [{name: "app", package: false, source, imports: selection.modules.map(item => item.name),
    notice: "Source entered in the local console; no redistribution license is inferred."}, ...selection.modules];
}
export function isSourceLocation(filename) {
  return filename === "sources/app.py" || Object.values(LIBRARY_CATALOG).some(profile =>
    profile.modules.some(module => filename === "sources/" + module.name.replaceAll(".", "/") + (module.package ? "/__init__.py" : ".py")));
}

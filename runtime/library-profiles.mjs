import {compileSourceModules} from "./source-modules.mjs";
import {verifyLibraries, hostProfile, LibraryProfileError, profileModules} from "./library-selection.mjs";
export {libraryProfile, hostProfile, verifyLibraries, snapshotLibraries, LibraryProfileError} from "./library-selection.mjs";

export async function compileProfileSource(source, {profile = "core-only/1", libraries = [], host = "output-only/1", ...options} = {}) {
  hostProfile(host);
  if (typeof source !== "string" && !(source instanceof Uint8Array)) throw new LibraryProfileError("Source requires text or UTF-8 bytes.");
  if (source.length > 262144) throw new LibraryProfileError("Source byte budget exceeded.", "COMPILE_BUDGET");
  const snapshot = typeof source === "string" ? source : new Uint8Array(source);
  const selected = await verifyLibraries(profile, libraries);
  const result = await compileSourceModules(profileModules(snapshot, selected), {...options, entry: "app"});
  return Object.freeze({...result, library: Object.freeze({id: profile, fingerprint: selected.fingerprint,
    modules: Object.freeze(selected.modules.map(item => item.name))})});
}

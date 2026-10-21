import {compileProfileSource} from "./library-profiles.mjs";
import {ModuleSession} from "./module-session.mjs";

export async function runLibraryProfileRequest(request) {
  let registry = null, session = null, stdout = "", response;
  try {
    const result = await compileProfileSource(request.source, {profile: request.profile,
      libraries: request.libraries, host: request.host, ...request.compileOptions});
    registry = result.registry; session = new ModuleSession(registry, {memoryLimits: request.memoryLimits});
    session.run(request.options, text => { stdout += text; });
    response = {ok: true, stdout, library: result.library, compilation: result.compilations, stats: session.stats()};
  } catch (error) {
    response = {ok: false, stdout, error: {type: error.name, code: error.code || "HOST", message: error.message,
      location: error.location || null, traceback: error.traceback || []}, stats: session?.stats() || null};
  } finally {
    session?.close(); registry?.close();
    if (session) response.closed = session.stats();
  }
  return response;
}

import {compileSourceModules} from "./source-modules.mjs";
import {ModuleSession} from "./module-session.mjs";

export async function runSourceRequest(request) {
  let registry = null, session = null, stdout = "", response, compilation = null;
  try {
    const result = await compileSourceModules(request.modules, {entry: request.entry || "app", ...request.compileOptions});
    registry = result.registry; compilation = result.compilations;
    session = new ModuleSession(registry, {memoryLimits: request.memoryLimits});
    const receipt = session.run(request.options, text => { stdout += text; });
    const exports = Object.fromEntries((request.exports || []).map(name => [name, session.read(name)]));
    response = {ok: true, stdout, receipt, exports, compilation, stats: session.stats()};
  } catch (error) {
    response = {ok: false, stdout, compilation, error: {code: error.code || "HOST", type: error.name,
      phase: error.phase || "execute", message: error.message, location: error.location || null,
      traceback: error.traceback || [], context: error.context || null}, stats: session?.stats() || null};
  } finally {
    session?.close(); registry?.close();
    if (session) response.closed = session.stats();
  }
  return response;
}

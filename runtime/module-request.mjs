import {verifyRegistry} from "./module-registry.mjs";
import {ModuleSession} from "./module-session.mjs";

export async function runModuleRequest(request) {
  let registry = null, session = null, stdout = "", response;
  try {
    registry = await verifyRegistry(request.manifest, new Map(Object.entries(request.assets).map(([path, bytes]) => [path, new Uint8Array(bytes)])));
    session = new ModuleSession(registry, {memoryLimits: request.memoryLimits});
    const receipt = session.run(request.options, text => { stdout += text; });
    response = {ok: true, stdout, receipt, stats: session.stats()};
  } catch (error) {
    response = {ok: false, stdout, error: {code: error.code || "HOST", type: error.name, message: error.message,
      location: error.location || null, traceback: error.traceback || [], context: error.context || null}, stats: session?.stats()};
  } finally {
    session?.close(); registry?.close();
    if (session) response.closed = session.stats();
  }
  return response;
}

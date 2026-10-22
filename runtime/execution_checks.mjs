// Test harness only; excluded from the pinned application asset closure.
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';
import {Execution} from './functions.mjs';

export async function runExecutionRequest(request) {
  let registry = null, session = null, stdout = '', response, compilation = null, boundaries = 0;
  try {
    const result = await compileSourceModules(request.modules, {entry: request.entry || 'app', ...request.compileOptions});
    registry = result.registry; compilation = result.compilations;
    session = new ModuleSession(registry, {memoryLimits: request.memoryLimits});
    const context = session.context;
    context.begin(request.options || {}, text => { stdout += text; });
    try {
      const execution = Execution.modules(context);
      try {
        do { execution.advance(request.quantum || 1); boundaries++; } while (execution.state === 'paused');
      } finally { execution.close(); }
      const name = registry.entry;
      const exports = Object.fromEntries((request.exports || []).map(name => [name, session.read(name)]));
      response = {ok: true, stdout, receipt: {module: name, status: 'ready', bytecode_sha256: registry.record(name).bytecode.sha256},
        exports, compilation, steps: context.steps, work: context.work};
    } finally { context.finish(); }
    response.stats = session.stats();
  } catch (error) {
    response = {ok: false, stdout, compilation, error: {code: error.code || 'HOST', type: error.name,
      phase: error.phase || 'execute', message: error.message, location: error.location || null,
      traceback: error.traceback || [], context: error.context || null}, stats: session?.stats() || null,
      steps: session?.context.steps ?? 0, work: session?.context.work ?? 0};
  } finally {
    session?.close(); registry?.close();
    if (session) response.closed = session.stats();
  }
  return {...response, boundaries, transitions: {...session?.context.transitions}};
}

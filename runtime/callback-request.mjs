// Conformance driver; excluded from application assets.
import {compileSourceModules} from './source-modules.mjs';
import {ModuleSession} from './module-session.mjs';

export async function runCallbackRequest(request) {
  let registry, session, stdout = '', response;
  try {
    ({registry} = await compileSourceModules(request.modules, {languageProfile: request.profile || 'classes-source/1'}));
    session = new ModuleSession(registry);
    const onOutput = text => { stdout += text; }, entry = session.start({}, onOutput);
    do { entry.advance(request.quantum || 1); } while (entry.state === 'parked');
    const handles = new Map(request.events.map(event => [event.name, null]));
    for (const name of handles.keys()) handles.set(name, session.register(name));
    const events = request.events.map(event => session.enqueue(handles.get(event.name), event.args || [], {}, onOutput));
    while (session.pending) {
      session.pump(request.quantum || 1);
      session.memory.collect([], {cleanup: true});
    }
    const results = await Promise.all(events.map(async event => {
      try { return {value: await event.result}; } catch (error) { return {error_type: error.name}; }
    }));
    response = {ok: true, stdout, results, stats: session.stats()};
  } catch (error) { response = {ok: false, stdout, error: {type: error.name, message: error.message}}; }
  finally { session?.close(); registry?.close(); if (session) response.closed = session.stats(); }
  return response;
}

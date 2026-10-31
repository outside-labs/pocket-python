import {InstanceValue} from "./function-objects.mjs";
import {completion, unaryTask, valueTask, callTask, dictionaryTask, attributeTask} from "./operations.mjs";

export function dynamicImporter({state, moduleContext, values, classes, builtinLookup, python, hard}) {
  const text = value => values.text(value instanceof InstanceValue && value.nativePayload !== undefined ? value.nativePayload : value);
  const raw = value => value instanceof InstanceValue ? value.nativePayload : value;
  const string = name => { const value = values.string(Array.from(name, ch => ch.codePointAt(0))); state.temporaries.push(value); return value; };
  const nextRecord = (kind, task) => completion(kind, task);
  const done = (task, site) => valueTask(task.module, site, task.after);
  const queue = (task, target, kind, site) => {
    const frame = state.frames.at(-1), plan = moduleContext.planLoad(frame.pool.module.name, target, 0, false);
    state.importCompletion = nextRecord(kind, task); state.importSite = site;
    state.pendingImport = {plan, inheritedException: frame.activeException}; return valueTask(null, site, completion("name-stored"));
  };
  const load = (task, site) => {
    const name = text(task.name);
    if (!name && !task.level) python('ValueError', 'Empty module name');
    let target = name;
    if (task.level) {
      if (!task.package) python('ImportError', 'attempted relative import with no known parent package');
      const parts = task.package.split('.');
      if (task.level > parts.length) python('ImportError', 'attempted relative import beyond top-level package');
      target = [...parts.slice(0, parts.length - task.level + 1), ...(name ? name.split('.') : [])].join('.');
    }
    return queue({...task, target}, target, 'import-loaded', site);
  };
  const field = (task, name, kind, site) => dictionaryTask(raw(task.globals), string(name), site, nextRecord(kind, task), 0, 'probe');
  const next = (task, site) => unaryTask('next', task.iterator, site, nextRecord('import-next', task));
  const exhausted = (task, site) => task.outer === null ? done(task, site) : next({...task, iterator: task.outer, outer: null, recursive: false}, site);
  const missing = (task, site) => {
    const target = task.module.name + '.' + text(task.item);
    // A missing optional fromlist child is left for IMPORT_FROM to diagnose.
    // Supplied children must still pass the caller's exact import grant.
    if (!moduleContext.registry.names.includes(target)) return next(task, site);
    return queue(task, target, 'import-child-loaded', site);
  };
  const invokeStatement = (task, callable, site) => callTask(callable,
    [task.name, task.globals, task.locals, task.fromlist, values.int(BigInt(task.level))], [], [], site, task.after);
  const resume = (task, value, site) => {
    if (task.kind === 'import-statement-locals') {
      task = {...task, locals: value};
      const result = builtinLookup(state.frames.at(-1), '__import__', site, nextRecord('import-statement-call', task));
      return result.task || invokeStatement(task, result.value, site);
    }
    if (task.kind === 'import-statement-call') return invokeStatement(task, value, site);
    if (task.kind === 'import-argument') {
      if (value < -2147483648n || value > 2147483647n) python('OverflowError', 'Python int too large to convert to C int');
      if (value < 0n) python('ValueError', 'level must be >= 0');
      if (value > 32n) hard('BUDGET', 'ExecutionLimitError', 'Relative import level exceeds the registry limit');
      task = {...task, level: Number(value)};
      if (!task.level) return load(task, site);
      if (task.globals === null) { const globals = values.dict([]); state.temporaries.push(globals); task = {...task, globals}; }
      if (!values.isDict(raw(task.globals))) python('TypeError', 'globals must be a dict');
      return field(task, '__package__', 'import-package', site);
    }
    if (task.kind === 'import-package') {
      const [found, item] = values.comparisonSequence(value);
      return field({...task, item: found ? item : null}, '__spec__', 'import-spec', site);
    }
    if (task.kind === 'import-spec') {
      const [found, spec] = values.comparisonSequence(value);
      const package_ = task.item === null ? null : text(task.item);
      if (task.item !== null && package_ === null) python('TypeError', '__package__ must be a string');
      task = {...task, package: package_};
      if (found && spec !== null) return attributeTask(spec, 'parent', site, nextRecord('import-spec-parent', task));
      if (package_ !== null) return load(task, site);
      return field(task, '__name__', 'import-name', site);
    }
    if (task.kind === 'import-spec-parent') {
      if (task.package !== null) return load(task, site);
      const parent = text(value); if (parent === null) python('TypeError', '__spec__.parent must be a string');
      return load({...task, package: parent}, site);
    }
    if (task.kind === 'import-name') {
      const [found, item] = values.comparisonSequence(value);
      if (!found) python('KeyError', "'__name__' not in globals");
      const name = text(item); if (name === null) python('TypeError', '__name__ must be a string');
      return field({...task, package: name}, '__path__', 'import-path', site);
    }
    if (task.kind === 'import-path') {
      const [found] = values.comparisonSequence(value);
      return load({...task, package: found ? task.package : task.package.split('.').slice(0, -1).join('.')}, site);
    }
    if (task.kind === 'import-loaded') return unaryTask('truth', task.fromlist, site, nextRecord('import-truth', {...task, module: value}));
    if (task.kind === 'import-truth') {
      if (!value) {
        const name = text(task.name), count = name ? name.split('.').length - 1 : 0;
        const root = !task.level ? task.target.split('.')[0] : count ? task.target.split('.').slice(0, -count).join('.') : task.target;
        return valueTask(moduleContext.module(root), site, task.after);
      }
      return attributeTask(task.module, '__path__', site, nextRecord('import-fromlist-path', task));
    }
    if (task.kind === 'import-fromlist-path') return unaryTask('iter', task.fromlist, site, nextRecord('import-iterator', task));
    if (task.kind === 'import-iterator') return next({...task, iterator: value}, site);
    if (task.kind === 'import-child-loaded' || task.kind === 'import-member') return next(task, site);
    if (task.kind === 'import-all-probe') return attributeTask(task.module, '__all__', site, nextRecord('import-all', task));
    if (task.kind === 'import-all') return unaryTask('iter', value, site,
      nextRecord('import-iterator', {...task, outer: task.iterator, recursive: true}));
    if (task.kind === 'import-next') {
      if (task.visits >= 1024) hard('BUDGET', 'ExecutionLimitError', 'Import fromlist work limit exceeded');
      const name = text(value); if (name === null) python('TypeError', 'Item in fromlist must be str');
      task = {...task, item: value, visits: task.visits + 1};
      if (name === '*') return task.recursive ? next(task, site) : attributeTask(task.module, '__all__', site, nextRecord('import-all-probe', task));
      return attributeTask(task.module, name, site, nextRecord('import-member', task), 0, 'get', value);
    }
    throw new TypeError('Unknown owned import continuation');
  };
  const start = (args, keywords, keywordValues, site, after) => {
    const labels = ['name', 'globals', 'locals', 'fromlist', 'level'];
    if (args.length > 5) python('TypeError', '__import__() takes at most 5 arguments');
    const bound = new Map(labels.slice(0, args.length).map((key, index) => [key, args[index]]));
    for (let i = 0; i < keywords.length; i++) {
      const key = keywords[i]; if (!labels.includes(key) || bound.has(key)) python('TypeError', 'Invalid or duplicate __import__ argument');
      bound.set(key, keywordValues[i]);
    }
    if (!bound.has('name')) python('TypeError', '__import__() requires a name');
    if (text(bound.get('name')) === null) python('TypeError', 'module name must be a string');
    const fromlist = bound.has('fromlist') ? bound.get('fromlist') : values.tuple([]); state.temporaries.push(fromlist);
    const task = {name: bound.get('name'), globals: bound.get('globals') ?? null, locals: bound.get('locals') ?? null,
      fromlist, level: 0, package: null, target: null, module: null, iterator: null, outer: null, recursive: false, visits: 0, item: null, after};
    return unaryTask('index', bound.has('level') ? bound.get('level') : 0n, site, nextRecord('import-argument', task));
  };
  const statement = (name, level, names, site) => {
    const nameValue = string(name), fromlist = names === null ? null : values.tuple(names.map(string)); state.temporaries.push(fromlist);
    const globals = values.environmentDictionary(state.frames.at(-1).callable.globals); state.temporaries.push(globals);
    const task = {name: nameValue, globals, fromlist, level, after: null};
    return state.frames.at(-1).fn.kind === 'function' ? valueTask(null, site, nextRecord('import-statement-locals', task)) : callTask(classes.builtin('locals'), [], [], [], site, nextRecord('import-statement-locals', task));
  };
  return {start, resume, statement, next, exhausted, missing, done};
}

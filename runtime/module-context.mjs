import {VerifiedRegistry, RegistryError} from "./module-registry.mjs";
import {MemoryArena, ResourceError} from "./memory.mjs";
import {Cell, Environment, ModuleValue, environmentCell} from "./function-objects.mjs";
import {ValueRuntime, valueLayout} from "./values.mjs";

const contexts = new WeakSet();
const failure = (code, name, message) => { throw new ResourceError(code, name, message); };
export const isModuleContext = value => contexts.has(value);

// One registry/cache belongs to one arena; host assets are never implicit imports.
export class ModuleContext {
  constructor(registry, memory) {
    if (!(registry instanceof VerifiedRegistry) || !(memory instanceof MemoryArena)) throw new TypeError("Verified registry and arena required.");
    registry.entry;
    this.registry = registry; this.memory = memory; this.cache = null; this.builtins = null; this.closed = false;
    this.chain = []; this.outputLeases = []; this.activeRun = false;
    let lease = null, external = null;
    const leave = memory.enter(() => [this.cache]);
    try {
      this.cache = memory.allocate(64, [], () => new Environment());
      this.builtins = memory.allocate(64, [], () => new Environment());
      this.binding(this.cache, "@builtins", this.builtins);
      lease = memory.pin([this.cache]); external = memory.external(registry.sizeBytes);
      this.lease = lease; this.external = external; contexts.add(this);
    } catch (error) { lease?.release(false); external?.(false); throw error; }
    finally { leave(); }
  }
  active() {
    if (this.closed) failure("STALE_REGISTRY", "ReferenceError", "Module session is closed.");
    this.registry.entry; this.memory.active();
  }
  begin(options, onOutput) {
    this.active();
    if (this.activeRun) throw new TypeError("Module sessions cannot reenter from host callbacks.");
    this.options = {maxSteps: 10000, maxWork: 1000000, maxDepth: 48, shouldCancel: null, ...options};
    for (const [key, maximum] of Object.entries({maxSteps: 1000000, maxWork: 100000000, maxDepth: 256})) {
      if (!Number.isSafeInteger(this.options[key]) || this.options[key] < 1 || this.options[key] > maximum) throw new TypeError("Invalid module execution budget.");
    }
    if ((this.options.shouldCancel !== null && typeof this.options.shouldCancel !== "function") || typeof onOutput !== "function" ||
        Object.keys(this.options).some(key => !["maxSteps", "maxWork", "maxDepth", "shouldCancel"].includes(key))) throw new TypeError("Invalid module execution options.");
    this.transitions = Object.create(null);
    this.steps = 0; this.work = 0; this.outputLength = 0; this.onOutput = onOutput; this.activeRun = true;
  }
  charge(amount, fail = failure) {
    if ((this.work += amount) > this.options.maxWork) fail("BUDGET", "ExecutionLimitError", "Value work budget exceeded.");
    if (this.options.shouldCancel?.()) fail("CANCELLED", "ExecutionCancelled", "Execution cancelled.");
  }
  tick(fail) {
    if (++this.steps > this.options.maxSteps) fail("BUDGET", "ExecutionLimitError", "Instruction budget exceeded.");
  }
  write(text, fail) {
    if ((this.outputLength += text.length) > 65536) fail("BUDGET", "ExecutionLimitError", "Output budget exceeded.");
    this.outputLeases.push(this.memory.external(32 + 2 * text.length)); this.onOutput(text);
  }
  finish() {
    for (const release of this.outputLeases) release(false);
    this.outputLeases = []; this.activeRun = false; this.onOutput = null;
    this.memory.collect([], {cleanup: true});
  }
  binding(environment, key, value) {
    if (environment.dictionary !== null) {
      const values = new ValueRuntime({memory: this.memory, charge: amount => this.charge(amount)});
      const name = values.string(Array.from(key, char => char.codePointAt(0)));
      return values.set(environment.dictionary, name, value);
    }
    let cell = environment.cells.get(key);
    if (!cell) {
      cell = this.memory.allocate(48, [value], () => { const item = new Cell(); item.bound = true; item.value = value; return item; });
      environment.cells.set(key, cell);
      try { const layout = valueLayout(environment); this.memory.resize(environment, layout.bytes, layout.children); }
      catch (error) { environment.cells.delete(key); throw error; }
    } else {
      this.memory.resize(cell, 48, [value]); cell.value = value; cell.bound = true;
    }
    environment.order.add(key);
  }
  module(name) { return this.cache.cells.get(name)?.value || null; }
  builtin(name, create) {
    const cell = this.builtins.cells.get(name);
    if (cell) return cell.value;
    const value = create(); this.binding(this.builtins, name, value); return value;
  }
  prepareInitialization(name, parent = false) {
    this.active();
    const existing = this.module(name);
    if (existing?.status === "ready") return {module: existing, ready: true};
    if (existing) {
      if (parent) return {module: existing, ready: true};
      throw new RegistryError("Cyclic imports are outside module-profile/1: " + [...this.chain, name].join(" -> "), "ImportError", "IMPORT");
    }
    if (this.chain.length >= 16) failure("BUDGET", "ExecutionLimitError", "Module initialization depth exceeds 16.");
    const record = this.registry.record(name), roots = [];
    const leave = this.memory.enter(() => roots, {charge: amount => this.charge(amount)});
    let module = null, closed = false;
    const release = () => {
      if (closed) return;
      closed = true;
      if (this.chain.at(-1) === name) this.chain.pop();
      leave();
    };
    const abort = () => {
      if (closed) return;
      if (module) { this.cache.cells.delete(name); module.status = "failed"; }
      release();
    };
    try {
      const environment = this.memory.allocate(64, [], () => new Environment()); roots.push(environment);
      module = this.memory.allocate(112 + 2 * name.length, [environment, null], () => new ModuleValue(name, record.package, environment)); roots.push(module);
      this.binding(this.cache, name, module); this.chain.push(name);
      const values = new ValueRuntime({memory: this.memory, charge: amount => this.charge(amount)});
      for (const [key, text] of Object.entries({__name__: name, __package__: record.package ? name : name.split(".").slice(0, -1).join("."),
        __file__: (record.source || record.bytecode).path})) this.binding(environment, key, values.string(Array.from(text, char => char.codePointAt(0))));
      return {module, ready: false, program: this.registry.program(name), abort,
        complete: () => {
          if (closed) throw new TypeError("Module initialization already settled.");
          try {
            module.status = "ready";
            const parts = name.split("."), namespace = this.module(parts.slice(0, -1).join("."));
            if (namespace && namespace.environment.dictionary === null) this.binding(namespace.environment, parts.at(-1), module);
          } catch (error) { abort(); throw error; }
          release();
        }};
    } catch (error) { abort(); throw error; }
  }
  entryPlan() { return this.initializationPlan(this.registry.entry, false); }
  initializationPlan(target, root) {
    return Object.freeze({names: Object.freeze([...this.registry.parents(target).map(name => Object.freeze({name, parent: true})),
      Object.freeze({name: target, parent: false})]), result: root ? target.split(".")[0] : target});
  }
  planLoad(importer, specifier, level, root) {
    return this.initializationPlan(this.registry.resolve(importer, specifier, level), root);
  }
  planAttribute(module, name, fromImport, importer) {
    if (!(module instanceof ModuleValue)) throw new RegistryError("Only module attributes are adopted in this profile.", "UnsupportedOperationError", "UNSUPPORTED");
    const cell = environmentCell(module.environment, name);
    if (cell?.bound) return {kind: "value", value: cell.value};
    if (fromImport && module.package) {
      const child = module.name + "." + name;
      if (this.registry.names.includes(child)) return {kind: "load", plan: this.planLoad(importer, child, 0, false)};
    }
    throw new RegistryError(fromImport ? "cannot import name '" + name + "' from '" + module.name + "'" :
      "module '" + module.name + "' has no attribute '" + name + "'", fromImport ? "ImportError" : "AttributeError", "IMPORT");
  }
  close() {
    if (this.closed) return;
    if (this.activeRun) throw new TypeError("Cannot close a running module session.");
    this.closed = true; this.lease.release(false); this.external(false);
    for (const release of this.outputLeases) release(false);
    this.outputLeases = []; this.chain = []; this.cache.cells.clear(); this.memory.collect([], {cleanup: true});
  }
}

import {VerifiedRegistry, RegistryError} from "./module-registry.mjs";
import {MemoryArena, ResourceError} from "./memory.mjs";
import {Cell, Environment, ModuleValue} from "./function-objects.mjs";
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
    let cell = environment.cells.get(key);
    if (!cell) {
      cell = this.memory.allocate(48, [value], () => { const item = new Cell(); item.bound = true; item.value = value; return item; });
      environment.cells.set(key, cell);
      try { const layout = valueLayout(environment); this.memory.resize(environment, layout.bytes, layout.children); }
      catch (error) { environment.cells.delete(key); throw error; }
    } else {
      this.memory.resize(cell, 48, [value]); cell.value = value; cell.bound = true;
    }
  }
  module(name) { return this.cache.cells.get(name)?.value || null; }
  builtin(name, create) {
    const cell = this.builtins.cells.get(name);
    if (cell) return cell.value;
    const value = create(); this.binding(this.builtins, name, value); return value;
  }
  ensure(name, invoke, parent = false) {
    this.active();
    const existing = this.module(name);
    if (existing?.status === "ready") return existing;
    if (existing) {
      if (parent) return existing;
      throw new RegistryError("Cyclic imports are outside module-profile/1: " + [...this.chain, name].join(" -> "), "ImportError", "IMPORT");
    }
    if (this.chain.length >= 16) failure("BUDGET", "ExecutionLimitError", "Module initialization depth exceeds 16.");
    const record = this.registry.record(name), roots = [];
    const leave = this.memory.enter(() => roots, {charge: amount => this.charge(amount)});
    let module = null;
    try {
      const environment = this.memory.allocate(64, [], () => new Environment()); roots.push(environment);
      module = this.memory.allocate(112 + 2 * name.length, [environment, null], () => new ModuleValue(name, record.package, environment)); roots.push(module);
      this.binding(this.cache, name, module); this.chain.push(name);
      const values = new ValueRuntime({memory: this.memory, charge: amount => this.charge(amount)});
      for (const [key, text] of Object.entries({__name__: name, __package__: record.package ? name : name.split(".").slice(0, -1).join("."),
        __file__: (record.source || record.bytecode).path})) this.binding(environment, key, values.string(Array.from(text, char => char.codePointAt(0))));
      invoke(module, this.registry.program(name));
      module.status = "ready";
      const parts = name.split("."), parentName = parts.slice(0, -1).join("."), namespace = this.module(parentName);
      if (namespace) this.binding(namespace.environment, parts.at(-1), module);
      return module;
    } catch (error) {
      if (module) { this.cache.cells.delete(name); module.status = "failed"; }
      throw error;
    } finally {
      if (this.chain.at(-1) === name) this.chain.pop();
      leave();
    }
  }
  load(importer, specifier, level, root, invoke) {
    const target = this.registry.resolve(importer, specifier, level);
    for (const name of this.registry.parents(target)) this.ensure(name, invoke, true);
    const module = this.ensure(target, invoke);
    return root ? this.module(target.split(".")[0]) : module;
  }
  attribute(module, name, fromImport, importer, invoke) {
    if (!(module instanceof ModuleValue)) throw new RegistryError("Only module attributes are adopted in this profile.", "UnsupportedOperationError", "UNSUPPORTED");
    const cell = module.environment.cells.get(name);
    if (cell?.bound) return cell.value;
    if (fromImport && module.package) {
      const child = module.name + "." + name;
      if (this.registry.names.includes(child)) return this.load(importer, child, 0, false, invoke);
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

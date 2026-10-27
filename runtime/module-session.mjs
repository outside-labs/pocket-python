import {ModuleContext} from "./module-context.mjs";
import {Execution} from "./functions.mjs";
import {MemoryArena, ResourceError} from "./memory.mjs";
import {encodeValue, ValueRuntime} from "./values.mjs";
import {FunctionValue} from "./function-objects.mjs";

export const MODULE_EVENT_PROFILE = "module-events/1";

const cancelled = () => new ResourceError("CANCELLED", "ExecutionCancelled", "Activation cancelled.");
const quantum = value => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) throw new TypeError("Invalid execution quantum.");
};

// Copy bounded data without getters, toJSON hooks, cycles or mutable aliases.
function transport(value) {
  let bytes = 0, nodes = 0;
  const active = new Set();
  const copy = (item, depth = 0) => {
    if (++nodes > 20000 || depth > 40) throw new ResourceError("QUOTA", "ExecutionLimitError", "Event value nesting/work budget exceeded.");
    const add = amount => { if ((bytes += amount) > 65536) throw new ResourceError("QUOTA", "ExecutionLimitError", "Event value byte budget exceeded."); };
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) { add(16); return item; }
    if (typeof item === "string") { add(16 + 2 * item.length); return item; }
    if (!item || typeof item !== "object" || active.has(item) ||
        ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError("Event values require finite plain data.");
    const array = Array.isArray(item), keys = Object.keys(item);
    if (keys.length > 2048 || Reflect.ownKeys(item).length !== keys.length + (array ? 1 : 0)) throw new TypeError("Invalid event value fields.");
    if (array && (item.length !== keys.length || keys.some((key, index) => key !== String(index)))) throw new TypeError("Event arrays must be dense.");
    add(32); active.add(item);
    try {
      const result = array ? [] : {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!Object.hasOwn(descriptor, "value")) throw new TypeError("Event values cannot contain accessors.");
        add(16 + 2 * key.length);
        Object.defineProperty(result, key, {value: copy(descriptor.value, depth + 1), enumerable: true});
      }
      return Object.freeze(result);
    } finally { active.delete(item); }
  };
  return {value: copy(value), bytes};
}

class ModuleActivation {
  #execution; #context; #finish; #complete; #state = "ready"; #result; #error = null;
  #released = false;
  constructor(execution, context, complete, finish) {
    this.#execution = execution; this.#context = context; this.#complete = complete; this.#finish = finish;
  }
  get state() { return this.#state; }
  get error() { return this.#error; }
  get result() { if (this.#state !== "completed") throw new TypeError("Activation has no completed result."); return this.#result; }
  snapshot() { return Object.freeze({...this.#execution.snapshot(), state: this.#state}); }
  #release() {
    if (this.#released) return;
    this.#released = true;
    try { this.#execution.close(); }
    finally { try { this.#context.finish(); } finally { this.#finish(); } }
  }
  advance(instructions = 128) {
    if (!["ready", "parked"].includes(this.#state)) throw new TypeError("Activation cannot advance from " + this.#state + ".");
    quantum(instructions); this.#state = "running";
    try {
      this.#execution.advance(instructions);
      if (this.#execution.state === "completed") {
        this.#result = this.#complete(this.#execution.result); this.#state = "completed"; this.#release();
      } else { this.#execution.park(); this.#state = "parked"; }
      return this.snapshot();
    } catch (error) { this.#error = error; this.#state = "failed"; this.#release(); throw error; }
  }
  drain() { do { this.advance(1000000); } while (this.#state === "parked"); return this.result; }
  close() {
    if (this.#state === "running") throw new TypeError("Cannot close a running activation.");
    if (["completed", "failed", "closed"].includes(this.#state)) return;
    this.#state = "closed"; this.#release();
  }
}

export class ModuleSession {
  #receipt = null;
  #active = null; #callbacks = new Map(); #queue = []; #event = null; #events = new Map();
  #generation = crypto.randomUUID(); #nextCallback = 0; #nextEvent = 0;
  #maxCallbacks; #maxEvents;
  constructor(registry, {memoryLimits = {}, maxCallbacks = 128, maxEvents = 128} = {}) {
    if (![maxCallbacks, maxEvents].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1024)) throw new TypeError("Invalid persistent session limits.");
    this.#maxCallbacks = maxCallbacks; this.#maxEvents = maxEvents;
    this.memory = new MemoryArena(memoryLimits);
    try { this.context = new ModuleContext(registry, this.memory); }
    catch (error) { this.memory.close(); throw error; }
  }
  run(options = {}, onOutput = () => {}) {
    return this.start(options, onOutput).drain();
  }
  #activate(create, options, onOutput, complete) {
    if (this.#active) throw new TypeError("A session activation is already pending.");
    this.context.begin(options, onOutput);
    try {
      const activation = new ModuleActivation(create(), this.context, complete, () => { this.#active = null; });
      this.#active = activation; return activation;
    } catch (error) { this.context.finish(); throw error; }
  }
  start(options = {}, onOutput = () => {}) {
    if (this.pending) throw new TypeError("Queued events must finish before module entry.");
    return this.#activate(() => Execution.modules(this.context), options, onOutput, () => {
      const name = this.context.registry.entry;
      if (!this.#receipt) this.#receipt = Object.freeze({module: name, status: "ready",
        bytecode_sha256: this.context.registry.record(name).bytecode.sha256});
      return this.#receipt;
    });
  }
  #callback(handle) {
    this.context.active();
    const entry = handle && this.#callbacks.get(handle.id);
    if (!entry || Object.keys(handle).length !== 2 || handle.type !== "callback" || handle.id !== entry.handle.id)
      throw new ResourceError("STALE_HANDLE", "ReferenceError", "Callback is unknown or released.");
    return entry;
  }
  register(name) {
    this.context.active();
    if (this.context.activeRun) throw new TypeError("Callbacks require a completed module activation.");
    if (typeof name !== "string" || !name.length || name.length > 256) throw new TypeError("Invalid callback export name.");
    const module = this.context.module(this.context.registry.entry), cell = module?.environment.cells.get(name), callable = cell?.value;
    if (module?.status !== "ready" || !cell?.bound || !(callable instanceof FunctionValue) || callable.pool.code.functions[callable.index].kind === "class" ||
        callable.pool.code.functions[callable.index].blocks.some(block => block.instructions.some(([op]) => ["yield", "yield-from"].includes(op))))
      throw new TypeError("Callback export must be an ordinary ready Python function.");
    if (this.#callbacks.size >= this.#maxCallbacks) throw new ResourceError("QUOTA", "ExecutionLimitError", "Callback budget exceeded.");
    const handle = Object.freeze({type: "callback", id: this.#generation + ":" + (++this.#nextCallback)});
    const lease = this.memory.pin([callable]);
    try {
      const release = this.memory.external(128 + 2 * (name.length + handle.id.length));
      this.#callbacks.set(handle.id, {handle, callable, lease, release}); return handle;
    } catch (error) { lease.release(); throw error; }
  }
  #call(entry, args, options, onOutput) {
    return this.#activate(() => Execution.callback(this.context, entry.callable, args), options, onOutput, lease => {
      try {
        const values = new ValueRuntime({numeric: true, charge: amount => this.context.charge(amount)});
        return transport(values.encode(lease.get()[0])).value;
      } finally { lease.release(); }
    });
  }
  enqueue(handle, args = [], options = {}, onOutput = () => {}) {
    const entry = this.#callback(handle);
    if (!Array.isArray(args) || args.length > 128 || typeof onOutput !== "function") throw new TypeError("Invalid event arguments/output callback.");
    if (this.pending >= this.#maxEvents) throw new ResourceError("QUOTA", "ExecutionLimitError", "Event queue budget exceeded.");
    const copied = transport(args);
    let work = 0;
    const values = new ValueRuntime({numeric: true, charge: amount => {
      if ((work += amount) > 1000000) throw new ResourceError("QUOTA", "ExecutionLimitError", "Event conversion work budget exceeded.");
    }});
    copied.value.forEach(value => values.decode(value));
    if (!options || typeof options !== "object" || Array.isArray(options) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new TypeError("Event options require plain data.");
    const keys = Reflect.ownKeys(options), snapshot = {};
    if (keys.length > 16) throw new TypeError("Too many event execution options.");
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new TypeError("Event execution options require ordinary data fields.");
      Object.defineProperty(snapshot, key, {value: descriptor.value, enumerable: true});
    }
    if (this.pending >= this.#maxEvents) throw new ResourceError("QUOTA", "ExecutionLimitError", "Event queue budget exceeded.");
    const release = this.memory.external(128 + copied.bytes), id = this.#generation + ":event:" + (++this.#nextEvent);
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; }); result.catch(() => {});
    const event = {id, entry, args: copied.value, options: Object.freeze(snapshot), onOutput, resolve, reject, release, activation: null, settled: false};
    this.#events.set(id, event); this.#queue.push(event);
    return Object.freeze({id, result, cancel: () => this.#cancelEvent(event)});
  }
  #settle(event, error = null) {
    if (event.settled) return;
    event.settled = true; this.#events.delete(event.id);
    this.#queue = this.#queue.filter(item => item !== event); if (this.#event === event) this.#event = null;
    event.release();
    if (error) event.reject(error); else event.resolve(event.activation.result);
  }
  #cancelEvent(event) {
    if (event.settled) return false;
    event.activation?.close(); this.#settle(event, cancelled()); return true;
  }
  pump(instructions = 128) {
    this.context.active(); quantum(instructions);
    if (this.#active?.state === "running") throw new TypeError("Session events cannot reenter running execution.");
    if (this.#active && !this.#event) throw new TypeError("Module initialization is pending.");
    if (!this.#event && this.#queue.length) {
      const event = this.#queue.shift(); this.#event = event;
      try { event.activation = this.#call(event.entry, event.args, event.options, event.onOutput); }
      catch (error) { this.#settle(event, error); return Object.freeze({pending: this.pending}); }
    }
    const event = this.#event;
    if (event) {
      try { event.activation.advance(instructions); if (event.activation.state === "completed") this.#settle(event); }
      catch (error) { this.#settle(event, error); }
    }
    return Object.freeze({pending: this.pending});
  }
  unregister(handle) {
    const entry = this.#callback(handle);
    if (this.#active?.state === "running" || this.context.activeRun && !this.#active) throw new TypeError("Cannot unregister during running execution.");
    for (const event of [...this.#events.values()]) if (event.entry === entry) this.#cancelEvent(event);
    this.#callbacks.delete(handle.id); entry.lease.release(false); entry.release(false); this.memory.collect([], {cleanup: true});
  }
  get pending() { return this.#events.size; }
  get callbacks() { return this.#callbacks.size; }
  read(name) {
    this.context.active();
    const module = this.context.module(this.context.registry.entry), cell = module?.environment.cells.get(name);
    if (!cell?.bound) throw new ReferenceError("Entry export is not bound: " + name);
    return encodeValue(cell.value);
  }
  stats() { return this.memory.stats(); }
  close() {
    if (this.#active?.state === "running" || this.context.activeRun && !this.#active) throw new TypeError("Cannot close a running module session.");
    this.#active?.close();
    for (const event of [...this.#events.values()]) this.#cancelEvent(event);
    for (const entry of this.#callbacks.values()) { entry.lease.release(false); entry.release(false); }
    this.#callbacks.clear();
    try { this.context.close(); }
    finally { this.memory.close(); }
  }
}

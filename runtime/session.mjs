import {MemoryArena, ResourceError} from "./memory.mjs";
import {execute} from "./vm.mjs";
import {encodeValue} from "./values.mjs";

export class HostHandles {
  #entries = new Map();
  #closed = false;
  #prefix = crypto.randomUUID();
  #next = 0n;

  constructor(memory, {maxHandles = 128} = {}) {
    if (!(memory instanceof MemoryArena) || !Number.isSafeInteger(maxHandles) || maxHandles < 1 || maxHandles > 4096) throw new TypeError("Invalid handle table options.");
    this.memory = memory;
    Object.defineProperty(this, "maxHandles", {value: maxHandles, enumerable: true});
  }
  active() {
    if (this.#closed) throw new ResourceError("STALE_HANDLE", "ReferenceError", "Handle table is closed.");
    this.memory.active();
  }
  create(value, {owner = "main", kind = "callback", roots = [], bytes = 0, dispose = null} = {}) {
    const lease = this.memory.pin(roots);
    try { return this.#insert(value, {owner, kind, bytes, dispose}, lease); }
    catch (error) { lease.release(); throw error; }
  }
  adoptValue(lease) {
    if (!this.memory.owns(lease)) throw new TypeError("Result lease belongs to another memory arena.");
    try { return this.#insert(lease.get()[0], {owner: "worker", kind: "python.value", bytes: 0, dispose: null}, lease); }
    catch (error) { lease.release(); throw error; }
  }
  #insert(value, {owner, kind, bytes, dispose}, lease) {
    this.active();
    if (!["main", "worker"].includes(owner) || typeof kind !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/.test(kind) ||
        !Number.isSafeInteger(bytes) || bytes < 0 || (dispose !== null && typeof dispose !== "function")) throw new TypeError("Invalid handle ownership, kind or allocation.");
    if (this.#entries.size >= this.maxHandles) throw new ResourceError("OOM", "MemoryError", "Host handle budget exceeded.");
    const id = this.#prefix + ":" + (++this.#next).toString();
    const releaseBytes = this.memory.external(128 + 2 * (id.length + kind.length) + bytes);
    const handle = Object.freeze({type: "handle", owner, kind, id});
    this.#entries.set(id, {handle, value, lease, releaseBytes, dispose});
    return handle;
  }
  #entry(handle, {owner, kind} = {}) {
    this.active();
    const entry = handle && typeof handle === "object" && this.#entries.get(handle.id);
    if (!entry || Object.keys(handle).length !== 4 || !["type", "owner", "kind", "id"].every(key => Object.hasOwn(handle, key)) ||
        handle.type !== "handle" || handle.owner !== entry.handle.owner || handle.kind !== entry.handle.kind ||
        (owner !== undefined && owner !== handle.owner) || (kind !== undefined && kind !== handle.kind)) {
      throw new ResourceError("STALE_HANDLE", "ReferenceError", "Unknown, released or mismatched host handle.");
    }
    return entry;
  }
  resolve(handle, expected = {}) { return this.#entry(handle, expected).value; }
  release(handle) {
    const entry = this.#entry(handle);
    this.#entries.delete(handle.id);
    entry.lease.release(false); entry.releaseBytes(false);
    this.memory.collect([], {cleanup: true});
    entry.dispose?.(entry.value);
  }
  get size() { return this.#entries.size; }
  close() {
    if (this.#closed) return [];
    this.#closed = true;
    const entries = [...this.#entries.values()], failures = [];
    this.#entries.clear();
    for (const entry of entries) { entry.lease.release(false); entry.releaseBytes(false); }
    if (this.memory.stats().state === "open") this.memory.collect([], {cleanup: true});
    for (const entry of entries) {
      try { entry.dispose?.(entry.value); } catch (error) { failures.push(error); }
    }
    return failures;
  }
}

export class InterpreterSession {
  constructor({memoryLimits = {}, maxHandles = 128} = {}) {
    this.memory = new MemoryArena(memoryLimits);
    this.handles = new HostHandles(this.memory, {maxHandles});
  }
  run(program, options = {}) {
    this.handles.active();
    const lease = execute(program, {...options, arena: this.memory, retainResult: true});
    return this.handles.adoptValue(lease);
  }
  read(handle) { return encodeValue(this.handles.resolve(handle, {owner: "worker", kind: "python.value"})); }
  release(handle) { this.handles.release(handle); }
  stats() { return Object.freeze({...this.memory.stats(), handles: this.handles.size}); }
  close() {
    try { return this.handles.close(); }
    finally { this.memory.close(); }
  }
}

import {valueLayout} from "./values.mjs";

export const MEMORY_LIMITS = Object.freeze({maxBytes: 8_388_608, maxObjects: 4096, maxRoots: 1024, maxFrames: 64});
const owners = new WeakMap();

export class ResourceError extends Error {
  constructor(code, name, message) { super(message); this.code = code; this.name = name; }
}

// Deterministic logical allocation accounting; physical reclamation uses host GC.
export class MemoryArena {
  #records = new Map();
  #pins = new Map();
  #external = new Map();
  #scopes = [];
  #parked = new Map();
  #closed = false;
  #bytes = 0;
  #peak = 0;
  #allocations = 0;
  #reclaimed = 0;
  #collections = 0;
  #leases = new WeakSet();
  #identityHashes = new WeakMap();
  #nextIdentityHash = 1n;

  constructor(options = {}) {
    const limits = {...MEMORY_LIMITS, ...options};
    for (const [key, maximum] of Object.entries({maxBytes: 67_108_864, maxObjects: 65536, maxRoots: 4096, maxFrames: 256})) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum) throw new TypeError("Invalid memory limit: " + key);
    }
    if (Object.keys(limits).some(key => !Object.hasOwn(MEMORY_LIMITS, key))) throw new TypeError("Unknown memory limit.");
    Object.defineProperty(this, "limits", {value: Object.freeze(limits), enumerable: true});
  }
  fail(code, name, message) {
    const fail = this.#scopes.at(-1)?.fail;
    if (fail) fail(code, name, message);
    throw new ResourceError(code, name, message);
  }
  active() { if (this.#closed) this.fail("STALE_HANDLE", "ReferenceError", "Memory arena is closed."); }
  get scopeDepth() { return this.#scopes.length; }
  #scopeCount() { return this.#scopes.length + [...this.#parked.values()].reduce((count, group) => count + group.length, 0); }

  parkScopes(boundary) {
    this.active();
    if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary >= this.#scopes.length) throw new TypeError("Invalid execution scope boundary.");
    const token = Object.freeze({});
    this.#parked.set(token, this.#scopes.splice(boundary));
    return token;
  }
  restoreScopes(token) {
    this.active();
    const group = this.#parked.get(token);
    if (!group) throw new TypeError("Unknown or restored execution scope owner.");
    this.#parked.delete(token);
    this.#scopes.push(...group);
  }

  enter(roots, {charge = () => {}, fail = null} = {}) {
    this.active();
    if (typeof roots !== "function" || typeof charge !== "function" || (fail !== null && typeof fail !== "function")) throw new TypeError("Invalid execution root scope.");
    if (this.#scopeCount() >= this.limits.maxFrames) this.fail("BUDGET", "ExecutionLimitError", "Active frame budget exceeded.");
    const scope = {roots, charge, fail};
    this.#scopes.push(scope);
    return () => {
      if (this.#closed) return;
      if (this.#scopes.at(-1) !== scope) throw new TypeError("Execution root scopes must unwind in order.");
      this.#scopes.pop();
      // Unwinding must release roots even after cancellation or a budget failure.
      this.collect([], {cleanup: true});
    };
  }

  collect(extraRoots = [], {probe = null, replacement = null, extraBytes = 0, cleanup = false} = {}) {
    this.active();
    const pending = [...extraRoots], records = new Map(), seen = new Set();
    let bytes = extraBytes, objects = 0, work = 0;
    const scope = this.#scopes.at(-1);
    const charge = (amount = 1) => {
      if ((work += amount) > 1_000_000) this.fail("BUDGET", "ExecutionLimitError", "Collection work budget exceeded.");
      if (!cleanup) scope?.charge(amount);
    };
    const check = () => {
      if (bytes > this.limits.maxBytes || objects > this.limits.maxObjects) this.fail("OOM", "MemoryError", "Accounted live-memory budget exceeded.");
    };
    for (const roots of this.#pins.values()) { bytes += 32 + 8 * roots.length; pending.push(...roots); }
    for (const amount of this.#external.values()) bytes += amount;
    for (const item of [...this.#parked.values()].flat().concat(this.#scopes)) {
      const roots = item.roots();
      if (!Array.isArray(roots)) throw new TypeError("Execution roots must be an array.");
      bytes += 128 + 8 * roots.length;
      pending.push(...roots);
    }
    if (probe) { bytes += probe.bytes; objects++; pending.push(...probe.children); }
    check();
    while (pending.length) {
      charge();
      const value = pending.pop();
      if (value !== null && typeof value === "object") {
        if (seen.has(value)) continue;
        seen.add(value);
        const owner = owners.get(value);
        if (owner && owner !== this) this.fail("STALE_HANDLE", "ReferenceError", "Value belongs to another memory arena.");
        const layout = replacement?.value === value ? replacement : valueLayout(value);
        bytes += layout.bytes; objects++;
        records.set(value, layout.bytes);
        // Avoid an unbounded spread/recursive traversal of cyclic graphs.
        for (const child of layout.children) { charge(); pending.push(child); }
      } else {
        const layout = valueLayout(value);
        if (layout.work) charge(layout.work);
        bytes += layout.bytes;
      }
      check();
    }
    for (const value of this.#records.keys()) if (!records.has(value)) this.#reclaimed++;
    for (const value of records.keys()) {
      if (!owners.has(value)) { owners.set(value, this); this.#allocations++; }
    }
    this.#records = records;
    this.#bytes = bytes;
    this.#peak = Math.max(this.#peak, bytes);
    this.#collections++;
    return this.stats();
  }

  allocate(bytes, children, create) {
    this.collect([], {probe: {bytes, children}});
    const value = create();
    owners.set(value, this);
    this.#records.set(value, bytes);
    this.#allocations++;
    return value;
  }
  resize(value, bytes, children) { this.collect([value], {replacement: {value, bytes, children}}); }
  primitive(value) { this.collect([value]); return value; }

  pin(roots) {
    this.active();
    if (!Array.isArray(roots) || roots.length > 256) throw new TypeError("Root leases require at most 256 explicit values.");
    if (this.#pins.size >= this.limits.maxRoots) this.fail("OOM", "MemoryError", "Root lease budget exceeded.");
    const key = {}, snapshot = Object.freeze([...roots]);
    this.collect(snapshot, {extraBytes: 32 + 8 * snapshot.length});
    this.#pins.set(key, snapshot);
    let released = false;
    const lease = Object.freeze({
      get: () => {
        this.active();
        if (released) this.fail("STALE_HANDLE", "ReferenceError", "Root lease was released.");
        return snapshot;
      },
      release: (collect = true) => {
        if (released || this.#closed) return false;
        released = true;
        this.#pins.delete(key);
        if (collect) this.collect([], {cleanup: true});
        return true;
      }
    });
    this.#leases.add(lease);
    return lease;
  }
  owns(lease) { return this.#leases.has(lease); }
  identityHash(value) {
    this.active();
    if (!this.#records.has(value)) throw new TypeError("Identity hashes require a live arena object.");
    if (!this.#identityHashes.has(value)) this.#identityHashes.set(value, this.#nextIdentityHash++);
    return this.#identityHashes.get(value);
  }

  external(bytes) {
    this.active();
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError("Invalid declared host allocation.");
    const key = {};
    this.collect([], {extraBytes: bytes});
    this.#external.set(key, bytes);
    let released = false;
    return (collect = true) => {
      if (released || this.#closed) return false;
      released = true;
      this.#external.delete(key);
      if (collect) this.collect([], {cleanup: true});
      return true;
    };
  }
  stats() {
    return Object.freeze({state: this.#closed ? "closed" : "open", bytes: this.#bytes, peakBytes: this.#peak,
      objects: this.#records.size, roots: this.#pins.size, frames: this.#scopeCount(), external: this.#external.size,
      allocations: this.#allocations, reclaimed: this.#reclaimed, collections: this.#collections});
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#reclaimed += this.#records.size;
    this.#records.clear(); this.#pins.clear(); this.#external.clear(); this.#scopes.length = 0; this.#parked.clear(); this.#bytes = 0;
    this.#identityHashes = new WeakMap(); this.#nextIdentityHash = 1n;
  }
}

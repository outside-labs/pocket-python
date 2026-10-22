import {ModuleContext} from "./module-context.mjs";
import {Execution} from "./functions.mjs";
import {MemoryArena} from "./memory.mjs";
import {encodeValue} from "./values.mjs";

export class ModuleSession {
  #receipt = null;
  constructor(registry, {memoryLimits = {}} = {}) {
    this.memory = new MemoryArena(memoryLimits);
    try { this.context = new ModuleContext(registry, this.memory); }
    catch (error) { this.memory.close(); throw error; }
  }
  run(options = {}, onOutput = () => {}) {
    this.context.begin(options, onOutput);
    try {
      const execution = Execution.modules(this.context);
      try { execution.drain(); } finally { execution.close(); }
      const name = this.context.registry.entry;
      if (!this.#receipt) this.#receipt = Object.freeze({module: name, status: "ready",
        bytecode_sha256: this.context.registry.record(name).bytecode.sha256});
      return this.#receipt;
    } finally { this.context.finish(); }
  }
  read(name) {
    this.context.active();
    const module = this.context.module(this.context.registry.entry), cell = module?.environment.cells.get(name);
    if (!cell?.bound) throw new ReferenceError("Entry export is not bound: " + name);
    return encodeValue(cell.value);
  }
  stats() { return this.memory.stats(); }
  close() {
    if (this.context.activeRun) throw new TypeError("Cannot close a running module session.");
    try { this.context.close(); }
    finally { this.memory.close(); }
  }
}

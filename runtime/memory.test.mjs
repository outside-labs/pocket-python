import assert from "node:assert/strict";
import {MemoryArena} from "./memory.mjs";
import {ValueRuntime} from "./values.mjs";
import {test} from "node:test";
import {memoryChecks} from "./memory_checks.mjs";

for (const [name, run] of memoryChecks) test(name, run);


test('read-only live-limit validation checks roots without changing collection observations', () => {
  const memory = new MemoryArena({maxBytes: 1000}), roots = [];
  const leave = memory.enter(() => roots);
  try {
    const values = new ValueRuntime({memory}), value = values.list([]); roots.push(value);
    memory.collect([], {cleanup: true}); const before = memory.stats();
    memory.collect([], {cleanup: true, validateOnly: true}); assert.deepEqual(memory.stats(), before);
    const large = new ValueRuntime().list(new Array(1000).fill(7n)); roots.push(large);
    assert.throws(() => memory.collect([], {cleanup: true, validateOnly: true}));
    roots.pop(); assert.deepEqual(memory.stats(), before);
  } finally { leave(); memory.close(); }
});

import {test} from "node:test";
import {memoryChecks} from "./memory_checks.mjs";

for (const [name, run] of memoryChecks) test(name, run);

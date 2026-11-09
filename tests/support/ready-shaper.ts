// Low-level native parity fixtures synchronously construct faces after module setup.
import { initialiseShaper } from "../../src/engine/harfbuzz/index.mjs";
await initialiseShaper();
export * from "../../src/engine/harfbuzz/index.mjs";

import {describe, it, expect} from "bun:test";
import { isDeno, isNode, isCloudflareWorkers, isBrowser } from "../core/runtime";

const originalGlobals: Record<string, any> = {};

function withGlobal(key: string, value: any, fn: () => void) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, key);
  if (had) originalGlobals[key] = (globalThis as any)[key];
  Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, writable: true, value });
  try { fn(); } finally {
    if (had) Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, writable: true, value: originalGlobals[key] });
    else Reflect.deleteProperty(globalThis, key as any);
  }
}

describe("runtime detection", () => {
  it("isNode baseline true", () => {
    expect(isNode()).toBe(true);
  });

  // Skipping isBun injection because some environments mark global properties non-configurable.

  it("isDeno when Deno present", () => {
    withGlobal("Deno", {}, () => {
      expect(isDeno()).toBe(true);
    });
  });

  it("isBrowser when window+document present", () => {
    withGlobal("window", {}, () => {
      withGlobal("document", {}, () => {
        expect(isBrowser()).toBe(true);
      });
    });
  });

  it("isCloudflareWorkers when caches+fetch present", () => {
    withGlobal("caches", {}, () => {
      withGlobal("fetch", () => {}, () => {
        expect(isCloudflareWorkers()).toBe(true);
      });
    });
  });
});

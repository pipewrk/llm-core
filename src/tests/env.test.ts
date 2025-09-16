// src/tests/env.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import { getEnv, setEnv } from "../core/env.ts";

// Simulate the std-env internal object
import { env as stdEnv } from "std-env";

describe("env module", () => {
  beforeEach(() => {
    delete stdEnv.TEST_KEY;
    delete stdEnv.NON_EXISTENT;
  });

  describe("getEnv", () => {
  it("returns existing env value", () => {
      stdEnv.TEST_KEY = "value";
      const val = getEnv("TEST_KEY" as any); // Cast to bypass keyof check for test
      expect(val).toBe("value");
    });

  it("returns default when env is missing", () => {
      const val = getEnv("NON_EXISTENT" as any, "default");
      expect(val).toBe("default");
    });

  it("throws when key is missing and no default", () => {
      expect(() => getEnv("NON_EXISTENT" as any)).toThrow("Missing environment variable");
    });
  });

  describe("setEnv", () => {
  it("sets an environment key and returns true", () => {
      const result = setEnv("TEST_KEY" as any, "newValue");
      expect(result).toBe(true);
      expect(stdEnv.TEST_KEY).toBe("newValue");
    });

  it("can be read back via getEnv", () => {
      setEnv("TEST_KEY" as any, "roundtrip");
      const val = getEnv("TEST_KEY" as any);
      expect(val).toBe("roundtrip");
    });
  });
});

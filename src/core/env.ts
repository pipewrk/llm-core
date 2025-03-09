import type { Env } from "../types/env.ts";
import { env } from "std-env";

/**
 * Retrieves an environment variable in a runtime-agnostic way.
 * Uses early returns and a clean switch statement for better readability.
 */
export function getEnv<K extends keyof Env>(key: K, defaultValue?: Env[K]): Env[K] {
  return env[key] ?? defaultValue ?? throwMissingKeyError(key);
}

/** Helper function to throw an error when a key is missing */
const throwMissingKeyError = (key: string): never => {
  throw new Error(`Missing environment variable: ${key}`);
};

/**
 * Sets an environment variable in a runtime-agnostic way.
 */
export function setEnv<K extends keyof Env>(key: K, value: Env[K]): Boolean {
  env[key] = value;
  return true;
  
}
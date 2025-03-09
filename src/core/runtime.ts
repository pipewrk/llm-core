/** Detects if the runtime is Bun */
export function isBun(): boolean {
  return typeof globalThis !== "undefined" && "Bun" in globalThis;
}

/** Detects if the runtime is Deno */
export function isDeno(): boolean {
  return typeof globalThis !== "undefined" && "Deno" in globalThis;
}

/** Detects if the runtime is Node.js */
export function isNode(): boolean {
  return typeof globalThis !== "undefined" && "process" in globalThis;
}

/** Detects if the runtime is Cloudflare Workers */
export function isCloudflareWorkers(): boolean {
  return typeof globalThis !== "undefined" && "caches" in globalThis && "fetch" in globalThis;
}

/** Detects if the runtime is a Browser */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

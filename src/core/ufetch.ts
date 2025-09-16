// ./ufetch.ts
import { isBun } from "./runtime.ts";

export interface UFetchOptions<TParsed = unknown> extends RequestInit {
  parseJson?: boolean;
  returnRaw?: boolean;
  mapJson?: (data: any) => TParsed;
}

export async function uFetch<T = unknown>(
  input: RequestInfo | URL,
  init?: UFetchOptions<T>
): Promise<T | Response> {
  if (isBun() && init?.body instanceof FormData) {
    init.body = init.body as unknown as BodyInit;
  }
  const res = await globalThis.fetch(input, init);
  const wantsRaw = init?.returnRaw;
  const shouldParse = init?.parseJson || (!wantsRaw && res.headers.get("content-type")?.includes("application/json"));
  if (!shouldParse) return res;
  const json = await res.json();
  return (init?.mapJson ? init.mapJson(json) : json) as T;
}

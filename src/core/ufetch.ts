import { isBun } from "./runtime.ts";

export async function uFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Handle FormData compatibility for Bun
  if (isBun() && init?.body instanceof FormData) {
    init.body = init.body as unknown as BodyInit;
  }

  if (isBun() && init?.body instanceof FormData) {
    init.body = init.body as unknown as BodyInit;
  }

  const response = await globalThis.fetch(input, init);

  // Automatically parse JSON responses
  if (response.headers.get("content-type")?.includes("application/json")) {
    return response.json()
  }
  return response;
}

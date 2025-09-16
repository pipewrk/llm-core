import {describe, it, expect, afterAll} from "bun:test";
import { uFetch } from "../core/ufetch";

describe("uFetch", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns raw Response when returnRaw true", async () => {
    globalThis.fetch = (async () => new Response("plain text", { status: 200 })) as any;
    const res = await uFetch("http://example.com", { returnRaw: true });
    expect(res).toBeInstanceOf(Response);
  });

  it("auto parses json when content-type present", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: 1 }), { headers: { "content-type": "application/json" } })) as any;
    const res = await uFetch<{ ok: number }>("http://example.com");
    expect(res).toEqual({ ok: 1 });
  });

  it("mapJson applied when provided", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ a: 2 }), { headers: { "content-type": "application/json" } })) as any;
    const res = await uFetch<number>("http://example.com", { mapJson: (d: any) => d.a * 10 });
    expect(res).toBe(20);
  });

  it("parseJson=false but json content-type skipped", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ b: 3 }), { headers: { "content-type": "application/json" } })) as any;
    const res = await uFetch<Response>("http://example.com", { parseJson: false, returnRaw: true });
    expect(res).toBeInstanceOf(Response);
  });
});

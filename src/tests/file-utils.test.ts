import {jest, describe, it, expect} from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  convertHtmlToPlainText,
  ensureDirectory,
  readFileContents,
  readFileContentsAsync,
  writeFileContentsAsync,
  saveJsonl,
  getDirContents,
  copyFile,
  getQaPath,
  readJsonlFile,
  checkExistingQa,
  getParsedOutputFiles,
  processParsedFiles,
  removeFile,
  prepareFormData,
  fetchJson,
} from "../core/file-utils";

const logger = {
  impt: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe("file-utils", () => {
  const base = mkdtempSync(join(tmpdir(), "llm-fu-"));

  it("convertHtmlToPlainText valid + passthrough", () => {
    const html = "<div><p>Hello <b>World</b></p></div>";
    const txt = convertHtmlToPlainText(html);
    expect(txt.toLowerCase()).toContain("hello world");
    const plain = convertHtmlToPlainText("Just text");
    expect(plain).toBe("Just text");
  });

  it("ensureDirectory creates when missing", () => {
    const dir = join(base, "newdir");
    ensureDirectory(dir, logger as any);
    expect(existsSync(dir)).toBe(true);
  });

  it("read/write async + sync helpers", async () => {
    const f = join(base, "a.txt");
    writeFileSync(f, "content", "utf-8");
    expect(readFileContents(f)).toBe("content");
    await writeFileContentsAsync(f, "new");
    expect(await readFileContentsAsync(f)).toBe("new");
  });

  it("saveJsonl and readJsonlFile", () => {
    const dir = join(base, "jsonl");
    mkdirSync(dir);
    saveJsonl(dir, "data", [{ a: 1 }, { b: 2 }], logger as any);
    const fp = join(dir, "data.jsonl");
    const rows = readJsonlFile(fp) as any[];
    expect(rows.length).toBe(2);
  });

  it("getDirContents filters extensions", () => {
    const dir = join(base, "exts");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.md"), "# A", "utf-8");
    writeFileSync(join(dir, "b.txt"), "B", "utf-8");
    writeFileSync(join(dir, "c.jsonl"), "{}", "utf-8");
    const md = getDirContents(dir, ["md"]);
    expect(md.length).toBe(1);
  });

  it("copyFile and getQaPath", async () => {
    const src = join(base, "src.txt");
    writeFileSync(src, "hello", "utf-8");
    const dst = join(base, "copied", "dst.txt");
    await copyFile(src, dst);
    expect(readFileSync(dst, "utf-8")).toBe("hello");
    expect(getQaPath(dst, "jsonl").endsWith("_qa.jsonl")).toBe(true);
  });

  it("convertJsonToJsonl + checkExistingQa (jsonl first)", () => {
    const dir = join(base, "qa1");
    mkdirSync(dir);
    const baseFile = join(dir, "f.txt");
    writeFileSync(baseFile, "ignore", "utf-8");
    const qaJsonl = getQaPath(baseFile, "jsonl");
    writeFileSync(qaJsonl, "{\"q\":1}\n{\"q\":2}", "utf-8");
    const found = checkExistingQa(baseFile, 2) as any[];
    expect(found.length).toBe(2);
  });

  it("checkExistingQa converts json -> jsonl", () => {
    const dir = join(base, "qa2");
    mkdirSync(dir);
    const baseFile = join(dir, "g.txt");
    writeFileSync(baseFile, "ignore", "utf-8");
    const qaJson = getQaPath(baseFile, "json");
    writeFileSync(qaJson, JSON.stringify([{ q: 1 }, { q: 2 }]), "utf-8");
    const found = checkExistingQa(baseFile, 2) as any[];
    expect(found.length).toBe(2);
    expect(existsSync(getQaPath(baseFile, "jsonl"))).toBe(true);
  });

  it("getParsedOutputFiles + processParsedFiles", () => {
    const dir = join(base, "parsed");
    mkdirSync(dir);
    const md = join(dir, "one.md");
    writeFileSync(md, "# Title", "utf-8");
    const jsonl = md + ".jsonl";
    writeFileSync(jsonl, JSON.stringify({ a: 1 }) + "\n", "utf-8");
    const pairs = getParsedOutputFiles(dir, logger as any);
    expect(pairs.length).toBe(1);
    const processed = processParsedFiles(dir, logger as any);
    expect(processed[0].jsonData.length).toBe(1);
  });

  it("getParsedOutputFiles warns when jsonl missing", () => {
    const dir = join(base, "parsed-miss");
    mkdirSync(dir);
    const md = join(dir, "two.md");
    writeFileSync(md, "# Two", "utf-8");
    const res = getParsedOutputFiles(dir, logger as any);
    expect(res.length).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("removeFile succeeds", () => {
    const f = join(base, "del.txt");
    writeFileSync(f, "x", "utf-8");
    expect(removeFile(f, logger as any)).toBe(true);
    expect(existsSync(f)).toBe(false);
  });

  it("prepareFormData Node branch", () => {
    const f = join(base, "upload.txt");
    writeFileSync(f, "u", "utf-8");
    const fd = prepareFormData(f);
    expect(fd).toBeInstanceOf(FormData);
  });

  it("fetchJson uses uFetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ v: 42 }), { headers: { "content-type": "application/json" } })) as any;
    const data = await fetchJson<{ v: number }>("http://x", { method: "GET" });
    expect(data.v).toBe(42);
    globalThis.fetch = originalFetch;
  });
});

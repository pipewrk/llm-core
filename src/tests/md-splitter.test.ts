import { beforeAll, describe, expect, test } from "bun:test";
import {
  markdownSplitter,
  groupMarkdownSegmentsByHeadings,
  enforceChunkSizeBounds,
  type MarkdownChunk,
  type MarkdownSegment,
} from "../core/markdown-splitter.ts";

const fixturePath = new URL("../../data/md-doc.md", import.meta.url);
describe("Markdown Splitter", () => {
  let mdDoc: string;
  let chunks: string[];

  beforeAll(async () => {
    mdDoc = await Bun.file(fixturePath.pathname).text();
    chunks = markdownSplitter(mdDoc);
  });

  test("should return chunks", () => {
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  test("should include at least one heading and one html-looking block", () => {
    const htmlLike = chunks.some(
      (c) => c.includes("<table>") || c.includes("</td>")
    );
    const headingLike = chunks.some((c) =>
      c.includes("Master GitHub markdown")
    );
    expect(htmlLike).toBe(true);
    expect(headingLike).toBe(true);
  });

  test("should log first few chunks for inspection", () => {
    console.log(
      chunks.slice(0, 5).map((c, i) => ({
        index: i,
        preview: c.slice(0, 60),
      }))
    );
  });

  test("should contain the root heading", () => {
    const main = chunks.find((c) => c.includes("Master GitHub markdown"));
    expect(main).toBeDefined();
  });

  test("should include numbered usage tips as list", () => {
    const numbered = chunks.find(
      (c) =>
        c.includes("1. Use HTML tags") && c.includes("2. Use either backticks")
    );
    expect(numbered).toBeDefined();
  });

  test("should preserve blockquote formatting", () => {
    const quote = chunks.find(
      (c) =>
        c.includes("> This is an intended blockquote") &&
        c.includes("> Meant to ensure tests passed")
    );
    expect(quote).toBeDefined();
  });

  test("should extract JSON code block inside <table>", () => {
    const json = chunks.find((c) => c.includes('"username": "marcoeidinger"'));
    expect(json).toBeDefined();
  });

  test("should extract Swift code block from comparison table", () => {
    const swift = chunks.find((c) =>
      c.includes('public var test: String = "Universe"')
    );
    expect(swift).toBeDefined();
  });

  test("should include markdown-defined table row text", () => {
    const mdTable = chunks.find((c) =>
      c.includes('"password_hash": "$2a$10$uhUIUmVWVnrBWx9rrDWhS')
    );
    expect(mdTable).toBeDefined();
  });

  test("should extract heading block with 'Bad'", () => {
    const bad = chunks.find(
      (c) => c.includes("# Bad") || c.includes("## Markdown defined table")
    );
    expect(bad).toBeDefined();
  });

  test("should retain HTML code block structure in last table", () => {
    const htmlCode = chunks.find((c) =>
      c.includes('"created_at": "2021-02-097T20:45:26.433Z"')
    );
    expect(htmlCode).toBeDefined();
  });

  // test("should include markdown table header separator", () => {
  //   const tableChunk = chunks.find((c) =>
  //     c.includes("| --- |") && c.includes("password_hash")
  //   );
  //   expect(tableChunk).toBeDefined();
  // });

  test("should not include heading levels greater than 6 as headers", () => {
    const tooDeep = chunks.find((c) => c.startsWith("#######"));
    expect(tooDeep).toBeUndefined();
  });

  // test("should convert h5 and h6 headings to bold text", () => {
  //   const h5 = chunks.find((c) => c.includes("**This H5 should be considered too deep**"));
  //   const h6 = chunks.find((c) => c.includes("**This H6 should be preserved**"));
  //   expect(h5).toBeDefined();
  //   expect(h6).toBeDefined();
  // });

  // test("should capture valid depth 4 heading", () => {
  //   const validH4 = chunks.find((c) => c.includes("#### This H4 is perfectly valid"));
  //   expect(validH4).toBeDefined();
  // });

  test("should wrap code blocks in triple backticks", () => {
    const code = chunks.find(
      (c) => c.includes("```") && c.includes("public var test")
    );
    expect(code).toBeDefined();
  });

  test("minSegmentLength merges tiny segments below threshold", () => {
    const simpleMd = `Short.\n\nAlso short.`;
    const result = markdownSplitter(simpleMd, { minChunkSize: 20 });
    expect(result.length).toBe(1);
    expect(result[0]).toContain("Short.");
    expect(result[0]).toContain("Also short.");
  });

  test("minSegmentLength=5 retains separate chunks when above threshold", () => {
    const simpleMd = `### First\n\nShort.\n\n### Second\n\nAlso short.`;
    const result = markdownSplitter(simpleMd, { minChunkSize: 5 });
    expect(result.length).toBe(2);
    expect(result[0]).toContain("Short.");
    expect(result[1]).toContain("Also short.");
  });
});

describe("groupMarkdownSegmentsByHeadings", () => {
  test("groups paragraphs under headings with correct headerPath", () => {
    const segments: MarkdownSegment[] = [
      { type: "heading", text: "Intro", headerPath: ["Intro"] },
      { type: "paragraph", text: "One", headerPath: ["Intro"] },
      { type: "paragraph", text: "Two", headerPath: ["Intro"] },
      { type: "heading", text: "Next", headerPath: ["Next"] },
      { type: "paragraph", text: "Three", headerPath: ["Next"] },
    ];

    const chunks = groupMarkdownSegmentsByHeadings(segments, 1, 1000);

    expect(chunks.length).toBe(2);
    expect(chunks[0].headerPath).toEqual(["Intro"]);
    expect(chunks[0].text).toMatch("One");
    expect(chunks[0].text).toMatch("Two");

    expect(chunks[1].headerPath).toEqual(["Next"]);
    expect(chunks[1].text).toMatch("Three");
  });

  test("still includes trailing segments after final heading", () => {
    const segments: MarkdownSegment[] = [
      { type: "heading", text: "Top", headerPath: ["Top"] },
      { type: "paragraph", text: "Alpha", headerPath: ["Top"] },
      { type: "paragraph", text: "Beta", headerPath: ["Top"] },
    ];

    const chunks = groupMarkdownSegmentsByHeadings(segments, 1, 1000);

    expect(chunks.length).toBe(1);
    expect(chunks[0].headerPath).toEqual(["Top"]);
    expect(chunks[0].text).toContain("Alpha");
    expect(chunks[0].text).toContain("Beta");
  });
  test("handles segments with no headings at all", () => {
    const segments: MarkdownSegment[] = [
      { type: "paragraph", text: "One", headerPath: [] },
      { type: "paragraph", text: "Two", headerPath: [] },
    ];

    const chunks = groupMarkdownSegmentsByHeadings(segments, 1, 1000);
    expect(chunks.length).toBe(1);
    expect(chunks[0].headerPath).toEqual([]);
    expect(chunks[0].text).toContain("One");
    expect(chunks[0].text).toContain("Two");
  });

  test("handles consecutive headings with no body", () => {
    const segments: MarkdownSegment[] = [
      { type: "heading", text: "One", headerPath: ["One"] },
      { type: "heading", text: "Two", headerPath: ["Two"] },
      { type: "paragraph", text: "Hi", headerPath: ["Two"] },
    ];

    const chunks = groupMarkdownSegmentsByHeadings(segments, 1, 1000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].headerPath).toEqual(["One"]);
    expect(chunks[0].text).toBe("One"); // or whatever logic applies to empty heading blocks

    expect(chunks[1].headerPath).toEqual(["Two"]);
    expect(chunks[1].text).toBe("Two\n\nHi");;
  });
});

describe("enforceChunkSizeBounds", () => {
  test("splits long chunks into multiple", () => {
    const chunks: MarkdownChunk[] = [
      {
        text: "a".repeat(5000),
        headerPath: ["Long"],
      },
    ];

    const final = enforceChunkSizeBounds(chunks, 100, 2000);
    expect(final.length).toBe(3); // 2000 + 2000 + 1000
    expect(final.every((c) => c.headerPath[0] === "Long")).toBe(true);
  });

  test("merges small chunk into previous if same headerPath", () => {
    const chunks: MarkdownChunk[] = [
      { text: "Long enough", headerPath: ["Same"] },
      { text: "tiny", headerPath: ["Same"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(1);
    expect(final[0].text).toContain("Long enough");
    expect(final[0].text).toContain("tiny");
  });

  test("merges small chunk into next if same headerPath", () => {
    const chunks: MarkdownChunk[] = [
      { text: "tiny", headerPath: ["Same"] },
      { text: "Big chunk follows", headerPath: ["Same"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(1);
    expect(final[0].text).toContain("tiny");
    expect(final[0].text).toContain("Big chunk follows");
  });

  test("keeps small chunk if it cannot merge safely", () => {
    const chunks: MarkdownChunk[] = [
      { text: "tiny", headerPath: ["A"] },
      { text: "long enough", headerPath: ["B"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(2);
    expect(final[0].text).toBe("tiny"); // fallback to include
  });

  test("merges alternating small chunks based on headerPath match", () => {
    const chunks: MarkdownChunk[] = [
      { text: "a", headerPath: ["Same"] },
      { text: "b", headerPath: ["Other"] },
      { text: "c", headerPath: ["Same"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 5, 1000);
    expect(final.length).toBe(3); // none can be safely merged
  });
  test("keeps small chunk when no merge options are viable", () => {
    const chunks: MarkdownChunk[] = [
      { text: "Long enough content here", headerPath: ["One"] },
      { text: "x", headerPath: ["Two"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(2);
    expect(final[1].text).toBe("x"); // Should be preserved despite not meeting size
  });
  test("does not split if chunk is exactly maxSize", () => {
    const chunks: MarkdownChunk[] = [
      { text: "x".repeat(2000), headerPath: ["Limit"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 2000);
    expect(final.length).toBe(1);
    expect(final[0].text.length).toBe(2000);
  });
});

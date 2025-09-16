import { beforeAll, describe, expect, it } from "bun:test";
import {
  markdownSplitter,
  groupMarkdownSegmentsByHeadings,
  enforceChunkSizeBounds,
  extractText,
  type MarkdownChunk,
  type MarkdownSegment,
} from "../core/markdown-splitter.ts";

const fixturePath = new URL("./fixtures/md-doc.md", import.meta.url);
describe("Markdown Splitter", () => {
  let mdDoc: string;
  let chunks: string[];

  beforeAll(async () => {
    mdDoc = await Bun.file(fixturePath.pathname).text();
    chunks = markdownSplitter(mdDoc);
  });

  it("should return chunks", () => {
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should include at least one heading and one html-looking block", () => {
    const htmlLike = chunks.some(
      (c) => c.includes("<table>") || c.includes("</td>")
    );
    const headingLike = chunks.some((c) =>
      c.includes("Master GitHub markdown")
    );
    expect(htmlLike).toBe(true);
    expect(headingLike).toBe(true);
  });

  it("should log first few chunks for inspection", () => {
    console.log(
      chunks.slice(0, 5).map((c, i) => ({
        index: i,
        preview: c.slice(0, 60),
      }))
    );
  });

  it("should contain the root heading", () => {
    const main = chunks.find((c) => c.includes("Master GitHub markdown"));
    expect(main).toBeDefined();
  });

  it("should include numbered usage tips as list", () => {
    const numbered = chunks.find(
      (c) =>
        c.includes("1. Use HTML tags") && c.includes("2. Use either backticks")
    );
    expect(numbered).toBeDefined();
  });

  it("should preserve blockquote formatting", () => {
    const quote = chunks.find(
      (c) =>
        c.includes("> This is an intended blockquote") &&
        c.includes("> Meant to ensure tests passed")
    );
    expect(quote).toBeDefined();
  });

  it("should extract JSON code block inside <table>", () => {
    const json = chunks.find((c) => c.includes('"username": "marcoeidinger"'));
    expect(json).toBeDefined();
  });

  it("should extract Swift code block from comparison table", () => {
    const swift = chunks.find((c) =>
      c.includes('public var test: String = "Universe"')
    );
    expect(swift).toBeDefined();
  });

  it("should include markdown-defined table row text", () => {
    const mdTable = chunks.find((c) =>
      c.includes('"password_hash": "$2a$10$uhUIUmVWVnrBWx9rrDWhS')
    );
    expect(mdTable).toBeDefined();
  });

  it("should extract heading block with 'Bad'", () => {
    const bad = chunks.find(
      (c) => c.includes("# Bad") || c.includes("## Markdown defined table")
    );
    expect(bad).toBeDefined();
  });

  it("should retain HTML code block structure in last table", () => {
    const htmlCode = chunks.find((c) =>
      c.includes('"created_at": "2021-02-097T20:45:26.433Z"')
    );
    expect(htmlCode).toBeDefined();
  });

  it("should return heading-grouped chunks when useHeadingsOnly is true", () => {
    const simpleMd = `
# A
Para 1.

# B
Para 2.
  `;

    const result = markdownSplitter(simpleMd, {
      minChunkSize: 5,
      maxChunkSize: 1000,
      useHeadingsOnly: true,
    });

    // Result should be plain strings
    expect(Array.isArray(result)).toBe(true);
    expect(typeof result[0]).toBe("string");
    expect(result.length).toBe(2);

    expect(result[0]).toContain("Para 1.");
    expect(result[1]).toContain("Para 2.");
  });

  it("should not include heading levels greater than 6 as headers", () => {
    const tooDeep = chunks.find((c) => c.startsWith("#######"));
    expect(tooDeep).toBeUndefined();
  });

  it("merges short heading chunk forward into next chunk", () => {
    const chunks: MarkdownChunk[] = [
      { text: "# Tiny Heading", headerPath: ["A"] },
      { text: "Next content here", headerPath: ["A"] },
    ];

    const result = enforceChunkSizeBounds(chunks, 30, 1000);

    expect(result.length).toBe(1);
    expect(result[0].text).toContain("# Tiny Heading");
    expect(result[0].text).toContain("Next content here");
  });

  it("should wrap code blocks in triple backticks", () => {
    const code = chunks.find(
      (c) => c.includes("```") && c.includes("public var test")
    );
    expect(code).toBeDefined();
  });

  it("minSegmentLength merges tiny segments below threshold", () => {
    const simpleMd = `Short.\n\nAlso short.`;
    const result = markdownSplitter(simpleMd, { minChunkSize: 20 });
    expect(result.length).toBe(1);
    expect(result[0]).toContain("Short.");
    expect(result[0]).toContain("Also short.");
  });

  it("minSegmentLength=5 retains separate chunks when above threshold", () => {
    const simpleMd = `### First\n\nShort.\n\n### Second\n\nAlso short.`;
    const result = markdownSplitter(simpleMd, { minChunkSize: 5 });
    expect(result.length).toBe(2);
    expect(result[0]).toContain("Short.");
    expect(result[1]).toContain("Also short.");
  });
});

describe("groupMarkdownSegmentsByHeadings", () => {
  it("groups paragraphs under headings with correct headerPath", () => {
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

  it("still includes trailing segments after final heading", () => {
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
  it("handles segments with no headings at all", () => {
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

  it("handles consecutive headings with no body", () => {
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
    expect(chunks[1].text).toBe("Two\n\nHi");
  });
});

describe("enforceChunkSizeBounds", () => {
  it("splits long chunks into multiple", () => {
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

  it("merges small chunk into previous if same headerPath", () => {
    const chunks: MarkdownChunk[] = [
      { text: "Long enough", headerPath: ["Same"] },
      { text: "tiny", headerPath: ["Same"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(1);
    expect(final[0].text).toContain("Long enough");
    expect(final[0].text).toContain("tiny");
  });

  it("merges small chunk into next if same headerPath", () => {
    const chunks: MarkdownChunk[] = [
      { text: "tiny", headerPath: ["Same"] },
      { text: "Big chunk follows", headerPath: ["Same"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(1);
    expect(final[0].text).toContain("tiny");
    expect(final[0].text).toContain("Big chunk follows");
  });

  it("keeps small chunk if it cannot merge safely", () => {
    const chunks: MarkdownChunk[] = [
      { text: "tiny", headerPath: ["A"] },
      { text: "long enough", headerPath: ["B"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(2);
    expect(final[0].text).toBe("tiny"); // fallback to include
  });

  it("merges alternating small chunks based on headerPath match", () => {
    const chunks: MarkdownChunk[] = [
      { text: "a", headerPath: ["Same"] },
      { text: "b", headerPath: ["Other"] },
      { text: "c", headerPath: ["Same"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 5, 1000);
    expect(final.length).toBe(3); // none can be safely merged
  });
  it("keeps small chunk when no merge options are viable", () => {
    const chunks: MarkdownChunk[] = [
      { text: "Long enough content here", headerPath: ["One"] },
      { text: "x", headerPath: ["Two"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 1000);
    expect(final.length).toBe(2);
    expect(final[1].text).toBe("x"); // Should be preserved despite not meeting size
  });
  it("does not split if chunk is exactly maxSize", () => {
    const chunks: MarkdownChunk[] = [
      { text: "x".repeat(2000), headerPath: ["Limit"] },
    ];

    const final = enforceChunkSizeBounds(chunks, 10, 2000);
    expect(final.length).toBe(1);
    expect(final[0].text.length).toBe(2000);
  });
});

describe("extractText", () => {
  it("extracts text from a simple text node", () => {
    const node = { type: "text", value: "Hello World" };
    expect(extractText(node)).toBe("Hello World");
  });

  it("extracts inlineCode", () => {
    const node = { type: "inlineCode", value: "code()" };
    expect(extractText(node)).toBe("`code()`");
  });

  it("extracts from emphasis and strong with children", () => {
    const node = {
      type: "strong",
      children: [
        { type: "text", value: "Bold" },
        { type: "emphasis", children: [{ type: "text", value: "Italic" }] },
      ],
    };
    expect(extractText(node)).toBe("**Bold*Italic***");
  });

  it("returns heading with direct children when text is present", () => {
    const heading = {
      type: "heading",
      depth: 2,
      children: [{ type: "text", value: "Title" }],
    };
    expect(extractText(heading)).toBe("## Title");
  });

  it("recovers fallback paragraph if heading has no text", () => {
    const paragraph = {
      type: "paragraph",
      children: [{ type: "text", value: "Recovered from sibling" }],
    };

    const heading = {
      type: "heading",
      depth: 2,
      children: [],
      position: {
        parent: {
          children: [] as any[],
        },
      },
    } as any;

    heading.position.parent.children = [heading, paragraph];

    const result = extractText(heading);
    expect(result).toBe("## Recovered from sibling");
    expect(heading.position.parent.children).toEqual([heading]);
  });

  it("recovers fallback text using hash formatting when heading level is 3", () => {
    const paragraph = {
      type: "paragraph",
      children: [{ type: "text", value: "Recovered Content" }],
    };

    const heading = {
      type: "heading",
      depth: 3,
      children: [],
      position: {
        parent: {
          children: [] as any[],
        },
      },
    } as any;

    heading.position.parent.children = [heading, paragraph];

    const result = extractText(heading);
    expect(result).toBe("### Recovered Content");
    expect(heading.position.parent.children).toEqual([heading]);
  });

  it("recovers fallback text using bold formatting when heading level is 6", () => {
    const paragraph = {
      type: "paragraph",
      children: [{ type: "text", value: "Deep Content" }],
    };

    const heading = {
      type: "heading",
      depth: 6,
      children: [],
      position: {
        parent: {
          children: [] as any[],
        },
      },
    } as any;

    heading.position.parent.children = [heading, paragraph];

    const result = extractText(heading);
    expect(result).toBe("**Deep Content**\n");
    expect(heading.position.parent.children).toEqual([heading]);
  });

  it("returns '** **' for heading with no text or fallback", () => {
    const heading = {
      type: "heading",
      depth: 5,
      children: [],
      position: {
        parent: {
          children: [],
        },
      },
    } as any;

    const result = extractText(heading);
    expect(result).toBe("** **");
  });

  it("extracts from paragraph/listItem/blockquote recursively", () => {
    const node = {
      type: "paragraph",
      children: [
        { type: "text", value: "Start " },
        {
          type: "strong",
          children: [{ type: "text", value: "Bold" }],
        },
      ],
    };

    expect(extractText(node)).toBe("Start **Bold**");
  });

  it("falls back to default recursive for unknown nodes", () => {
    const node = {
      type: "customNode",
      children: [
        { type: "text", value: "X" },
        { type: "text", value: "Y" },
      ],
    };

    expect(extractText(node)).toBe("XY");
  });

  it("returns empty string for unknown node without children", () => {
    const node = { type: "weirdNode" };
    expect(extractText(node)).toBe("");
  });

  it("fallback paragraph exists but contains no text should not return early", () => {
    const paragraph = {
      type: "paragraph",
      children: [{ type: "text", value: "" }],
    };

    const heading = {
      type: "heading",
      depth: 6,
      children: [],
      position: {
        parent: {
          children: [],
        },
      },
    } as any;

    heading.position.parent.children = [heading, paragraph];

    const result = extractText(heading);

    // Should fall through to default "** **"
    expect(result).toBe("** **");
    expect(heading.position.parent.children).toEqual([heading, paragraph]); // not spliced
  });
});

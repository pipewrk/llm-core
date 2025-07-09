import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit, SKIP } from "unist-util-visit";
import type {
  Root,
  Heading,
  Paragraph,
  Code,
  Table,
  TableRow,
  TableCell,
  List,
  Blockquote,
} from "mdast";

export type MarkdownSegment = {
  text: string;
  type: "heading" | "paragraph" | "code" | "table" | "list" | "quote" | "html";
  headerPath: string[];
};

export type MarkdownChunk = {
  text: string;
  headerPath: string[];
};

function normalizeText(text: string, type: MarkdownSegment["type"]): string {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0) // Remove lines that are empty or whitespace-only
    .join("\n");
}

export function markdownSplitter(
  markdown: string,
  opts?: {
    minChunkSize?: number;
    maxChunkSize?: number;
    useHeadingsOnly?: boolean;
  }
): string[] {
  const minChunkSize = opts?.minChunkSize ?? 30;
  const maxChunkSize = opts?.maxChunkSize ?? 2000;
  const useHeadingsOnly = opts?.useHeadingsOnly ?? false;

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as Root;

  const segments: MarkdownSegment[] = [];
  let headerPath: string[] = [];

  visit(tree, (node) => {
    let seg: MarkdownSegment | null = null;

    switch (node.type) {
      case "heading": {
        const txt = extractText(node as Heading);
        headerPath = [...headerPath.slice(0, (node as Heading).depth - 1), txt];
        seg = { text: txt, type: "heading", headerPath: [...headerPath] };
        break;
      }
      case "paragraph": {
        const txt = extractText(node as Paragraph);
        seg = { text: txt, type: "paragraph", headerPath: [...headerPath] };
        break;
      }
      case "blockquote": {
        const txt = extractQuote(node as Blockquote);
        seg = { text: txt, type: "quote", headerPath: [...headerPath] };
        break;
      }
      case "code": {
        const txt = (node as Code).value;
        seg = {
          text: `\`\`\`\n${txt}\n\`\`\``,
          type: "code",
          headerPath: [...headerPath],
        };
        break;
      }
      case "list": {
        const txt = extractList(node as List);
        seg = { text: txt, type: "list", headerPath: [...headerPath] };
        break;
      }
      case "table": {
        const txt = extractTable(node as Table);
        seg = { text: txt, type: "table", headerPath: [...headerPath] };
        break;
      }
      case "html": {
        const txt = (node as any).value;
        seg = { text: txt, type: "html", headerPath: [...headerPath] };
        break;
      }
    }

    if (seg) {
      // console.log(`Segment: ${seg.type} - ${seg.text}`);
      // Normalize text and push to segments
      seg.text = normalizeText(seg.text, seg.type);
      // console.log(`Normalized: ${seg.text}`);
      segments.push(seg);
      return SKIP;
    }
  });

  const merged = mergeTinyMarkdownSegments(segments, minChunkSize);

  if (useHeadingsOnly) {
    return groupMarkdownSegmentsByHeadings(
      merged,
      minChunkSize,
      maxChunkSize
    ).map((c) => c.text);
  }

  const grouped: string[] = [];
  let currentText = "";
  let currentPath: string[] = [];

  for (const seg of merged) {
    if (currentPath.join("/") !== seg.headerPath.join("/")) {
      if (currentText) grouped.push(currentText);
      currentText = seg.text;
      currentPath = seg.headerPath;
    } else {
      currentText += "\n\n" + seg.text;
    }
  }

  if (currentText) grouped.push(currentText);

  return grouped;
}

export function groupMarkdownSegmentsByHeadings(
  segments: MarkdownSegment[],
  minSize = 30,
  maxSize = 2000
): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  let current: string[] = [];
  let path: string[] = [];

  for (const seg of segments) {
    if (seg.type === "heading") {
      if (current.length > 0) {
        chunks.push({ text: current.join("\n\n"), headerPath: [...path] });
        current = [];
      }

      // This line is crucial: include the heading itself
      current.push(seg.text);
      path = seg.headerPath;
    } else {
      current.push(seg.text);
    }
  }

  if (current.length > 0) {
    chunks.push({ text: current.join("\n\n"), headerPath: [...path] });
  }

  return enforceChunkSizeBounds(chunks, minSize, maxSize);
}

export function enforceChunkSizeBounds(
  chunks: MarkdownChunk[],
  minSize: number,
  maxSize: number
): MarkdownChunk[] {
  const final: MarkdownChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const curr = chunks[i];
    const text = curr.text.trim();

    // Case 1: Too long split into chunks
    if (text.length >= maxSize) {
      for (let j = 0; j < text.length; j += maxSize) {
        final.push({
          text: text.slice(j, j + maxSize),
          headerPath: [...curr.headerPath],
        });
      }
      continue;
    }

    // Case 2: Too short try to merge
    if (text.length < minSize) {
      const prev = final.at(-1);
      const next = chunks[i + 1];

      const sameHeaderAs = (a?: MarkdownChunk, b?: MarkdownChunk) =>
        a?.headerPath.join("/") === b?.headerPath.join("/");

      const isHeading = curr.text.startsWith("#");

      const canMergeForward = isHeading && next;
      const canMergeBack = prev && sameHeaderAs(prev, curr);
      const canMergeNext = next && sameHeaderAs(next, curr);

      if (canMergeForward) {
        next.text = curr.text + "\n\n" + next.text;
        continue;
      }

      if (canMergeBack) {
        prev.text += "\n\n" + text;
        continue;
      }

      if (canMergeNext) {
        next.text = text + "\n\n" + next.text;
        continue;
      }

      // Fallback: push as-is
      final.push({ text, headerPath: [...curr.headerPath] });
      continue;
    }

    // Case 3: In bounds use directly
    final.push({ text, headerPath: [...curr.headerPath] });
  }

  return final;
}

export function extractText(node: any): string {
  if (!node) return "";

  switch (node.type) {
    case "text":
      return node.value;

    case "inlineCode":
      return `\`${node.value}\``;

    case "emphasis":
      return `*${(node.children ?? []).map(extractText).join("")}*`;

    case "strong":
      return `**${(node.children ?? []).map(extractText).join("")}**`;

    case "heading": {
      const text = (node.children ?? []).map(extractText).join("").trim();
      const level = node.depth;

      // If text is empty, try to recover from adjacent siblings
      if (!text && Array.isArray(node.position?.parent?.children)) {
        const siblings = node.position.parent.children;
        const index = siblings.indexOf(node);
        const fallback = siblings[index + 1];

        if (fallback?.type === "paragraph") {
          const fallbackText = extractText(fallback).trim();
          if (fallbackText) {
            siblings.splice(index + 1, 1); // remove so it's not processed again
            return level <= 4
              ? `${"#".repeat(level)} ${fallbackText}`
              : `**${fallbackText}**\n`;
          }
        }
      }

      // Apply normal formatting
      if (level <= 4) return `${"#".repeat(level)} ${text}`;
      return text ? `**${text}**\n` : "** **"; // edge case: force line break if still empty
    }

    case "paragraph":
    case "listItem":
    case "blockquote":
      return (node.children ?? []).map(extractText).join("");

    default:
      if (Array.isArray(node.children)) {
        return node.children.map(extractText).join("");
      }
      return "";
  }
}


function extractQuote(block: Blockquote): string {
  return block.children
    .map((child) => {
      const txt = extractText(child).trim();
      return txt
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
    })
    .join("\n\n");
}

function extractTable(table: Table): string {
  const headerRow = table.children[0];
  const headers = headerRow.children.map((cell: TableCell) =>
    extractText(cell)
  );
  const separator = headers.map(() => "---");
  const headerLine = headers.join(" | ");
  const separatorLine = separator.join(" | ");

  const bodyRows = table.children
    .slice(1)
    .map((row: TableRow) =>
      row.children.map((cell: TableCell) => extractText(cell)).join(" | ")
    );

  return [headerLine, separatorLine, ...bodyRows].join("\n");
}

function extractList(list: List): string {
  return list.children
    .map((item, i) => {
      const bullet = list.ordered ? `${(list.start ?? 1) + i}.` : `-`;
      return `${bullet} ${extractText(item)}`;
    })
    .join("\n");
}

export function mergeTinyMarkdownSegments(
  segments: MarkdownSegment[],
  minLength = 30
): MarkdownSegment[] {
  const merged: MarkdownSegment[] = [];

  for (const seg of segments) {
    const prev = merged[merged.length - 1];

    const canMerge =
      seg.text.length < minLength &&
      prev &&
      prev.type !== "heading" &&
      seg.type !== "heading" &&
      prev.headerPath.join("/") === seg.headerPath.join("/");

    if (canMerge) {
      prev.text += "\n\n" + seg.text;
      continue;
    }

    if (seg.text.trim()) {
      merged.push({ ...seg });
    }
  }

  return merged;
}

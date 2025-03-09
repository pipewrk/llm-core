import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { getEnv } from "./core";
import ignored from "../ignore.json";
import sites from "../sites.json";

export type NewsExtractionResponse = {
  title: string;
  link: string;
  description?: string | null;
  image?: {
    url: string;
    caption?: string | null;
  };
};

export type Source = keyof typeof sites;

export type FetchMarkdownArgs = {
  url: string;
  selector: string;
  apiKey: string;
};

export type SaveMarkdownArgs = {
  filename: string;
  content: string;
};

export type ExtractNewsArgs = {
  markdown: string;
  ignoreList: string[];
};

export type ProcessNewsArgs = {
  url: string;
  filename: string;
  selector: string;
};

export type ExtractNewsFromFileArgs = {
  filename: string;
  ignoreList: string[];
};
/**
 * Fetches and returns markdown content from a given URL.
 */
export async function fetchMarkdownContent({
  url,
  selector,
}: FetchMarkdownArgs): Promise<string> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Authorization: `Bearer ${getEnv("JINA_API_KEY")}`,
      "x-target-selector": selector,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  return response.text();
}

/**
 * Saves markdown content to a file.
 */
export async function saveMarkdownToFile({
  filename,
  content,
}: SaveMarkdownArgs): Promise<void> {
  await Bun.write(`${filename}.md`, content);
}

/**
 * Determines whether a title should be ignored based on an ignore list.
 */
export function shouldIgnoreTitle(title: string, ignoreList: string[]): boolean {
  return ignoreList.some((filter) => title.includes(filter));
}

/**
 * Extracts unique links from markdown content.
 */
export function extractUniqueLinks(markdown: string): Set<string> {
  const tree = unified().use(remarkParse).parse(markdown);
  const links = new Set<string>();

  visit(tree, "link", (node) => {
    if (typeof node.url === "string" && node.url.startsWith("http")) {
      links.add(node.url);
    }
  });

  return links;
}

/**
 * Parses markdown and extracts structured news articles.
 */
export function extractNewsArticles({
  markdown,
  ignoreList,
}: ExtractNewsArgs): NewsExtractionResponse[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const articles = new Map<string, NewsExtractionResponse>();
  let lastImage: NewsExtractionResponse["image"] | null = null;

  visit(tree, "link", (node) => {
    const url = node.url;
    if (!url.startsWith("http")) return;

    const title = node.children
      .filter((child) => child.type === "text")
      .map((child) => child.value)
      .join("")
      .trim();

    // Handle inline images
    if (node.children.length > 0 && node.children[0].type === "image") {
      const imageNode = node.children[0];
      let caption = imageNode.alt?.trim();
      if (caption) {
        caption = caption.replace(/^Image \d+:\s*/, "");
      }
      lastImage = { url: imageNode.url, caption };
      return;
    }

    // Assign title or fallback to last image caption
    const finalTitle = title || lastImage?.caption;
    if (!finalTitle) return;
    if (shouldIgnoreTitle(finalTitle.trim(), ignoreList)) return;

    if (!articles.has(url)) {
      articles.set(url, { title: finalTitle, link: url });
    }

    // Attach image if available
    if (lastImage) {
      if (lastImage.caption === finalTitle) {
        lastImage.caption = null;
      }
      articles.get(url)!.image = lastImage;
      lastImage = null;
    }
  });

  return Array.from(articles.values());
}



async function validateExtraction(label: string, source: Source) {
  const config = sites[source];
  if (!config) {
    throw new Error(`Site not found: ${source}`);
  }
  const {urls} = config;
  const cat = urls.find((url) => url.label === label);
  if (!cat) {
    throw new Error(`Category not found: ${label}`);
  }
  const markdown = await Bun.file(`${filename}.md`).text();

  const structuredNews = extractNewsArticles({ markdown, ignoreList: ignored);
  const uniqueLinks = extractUniqueLinks(markdown);

  console.log(JSON.stringify(structuredNews, null, 2));
}

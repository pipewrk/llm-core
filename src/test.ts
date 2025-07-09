/**
 * News Extraction & Classification Pipeline
 * 
 * This script fetches news content in markdown form using a proxy scraping API (`r.jina.ai`),
 * parses and structures it into articles, optionally classifies them using an AI-based
 * zero-shot classifier (e.g., OpenAI's embedding models), and groups them into categories.
 *
 * Sources are defined per label (e.g., "breaking_news") per site (e.g., "bbc", "apnews").
 * Input and output directories are read from environment variables.
 *
 * Usage:
 *   bun run script.ts <source> <label>
 * Or used programmatically via `processMultipleSources()` and a pre-defined config.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { getEnv } from "./core/env.ts";
import { ClassificationService } from "./core/classification-service.ts";

export type NewsExtractionResponse = {
  title: string;
  link: string;
  description?: string | null;
  image?: {
    url: string;
    caption?: string | null;
  };
};

const getMd = (file: string) => Bun.file(`${getEnv("INPUT_DIR")}/${file}`)
const getJson = (file: string) => Bun.file(`${getEnv("OUTPUT_DIR")}/${file}`);

export type Source = "apnews" | "bbc" | "reuters" | "aljazeera"

export type FetchMarkdownArgs = {
  url: string;
  selector: string;
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
 * Fetches markdown content from a given URL using Jina’s reverse proxy and selector.
 * 
 * @param url - The target URL to scrape.
 * @param selector - CSS selector used by the proxy to extract content.
 * @returns Raw markdown string extracted from the target page.
 * @throws If the HTTP response fails.
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
 * Determines if a given article title should be ignored based on ignore patterns.
 * 
 * @param title - The article title to evaluate.
 * @param ignoreList - List of string filters to match against.
 * @returns True if the title matches any filter.
 */
export function shouldIgnoreTitle(title: string, ignoreList: string[]): boolean {
  return ignoreList.some((filter) => title.includes(filter));
}

/**
 * Extracts all unique external links from markdown content.
 * 
 * @param markdown - Raw markdown input.
 * @returns A set of unique HTTP(S) URLs.
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
 * Parses markdown and structures news articles with titles, links, and optional images.
 * Handles inline image captions and de-duplicates entries.
 * 
 * @param markdown - Raw markdown string from a source.
 * @param ignoreList - List of title patterns to exclude.
 * @returns An array of structured news articles.
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


export interface DownloadAndExtractArgs {
  cats: string[];
  ignored: string[];
  label: string;
  config: { selector: string, urls: { label: string; url: string; filename: string }[] };
}


/**
 * Loads markdown for a given site/label combo, either from disk or by fetching it.
 * Then extracts articles into structured form.
 *
 * @param cats - Category labels to be used downstream.
 * @param label - Label for the content (e.g., "breaking_news").
 * @param config - Site configuration containing selector and URL+filename mapping.
 * @param ignored - List of patterns to filter out irrelevant articles.
 * @returns Structured article list (not yet classified).
 */
async function downloadAndExtract({cats, label, config, ignored}: DownloadAndExtractArgs) {
  const { urls } = config;
  const cat = urls.find((url) => url.label === label);
  if (!cat) {
    throw new Error(`Category not found: ${label}`);
  }
  const mdFile = getMd(`${cat.filename}.md`);
  const exists = await mdFile.exists();
  let markdown: string;
  if (!exists) {
    console.log(`File not found: ${cat.filename}.md, fetching...`);
    markdown = await fetchMarkdownContent({
      url: cat.url,
      selector: config.selector,
    })
    console.log(`Saving to ${cat.filename}.md...`);
    await Bun.write(mdFile, markdown);
  } else {
    markdown = await mdFile.text();
  }
  // const jsonFile = getJson(`${cat.filename}.json`);
  const structuredNews = extractNewsArticles({ markdown, ignoreList: ignored });
  return structuredNews
  // Bun.write(jsonFile, JSON.stringify(structuredNews, null, 2));
  // const classificationResults = await classifyNewsArticles(structuredNews, cats);
  // return classificationResults
  // console.log(classificationResults)
  // console.log(`Extracted ${structuredNews.length} articles from ${cat.filename}.md`);
}

/**
 * Uses a zero-shot classifier to assign categories to structured news articles.
 * 
 * @param structuredNews - Array of news articles with `title` and `link`.
 * @param categories - Labels to classify into (e.g., politics, tech).
 * @returns An object mapping each category to its matched articles.
 * @throws If no input articles are provided.
 */
export async function classifyNewsArticles(
  structuredNews: NewsExtractionResponse[],
  categories: string[]
): Promise<{ [category: string]: NewsExtractionResponse[] }> {
  if (!structuredNews.length) {
    throw new Error("No articles provided for classification.");
  }

  console.log(`Classifying ${structuredNews.length} articles...`);

  // Initialize the classifier with `ai-zero-shot-classifier`
  const classifier = await ClassificationService.instance(
    "openai", // AI provider (e.g., "openai", "groq")
    "text-embedding-3-small", // Model for text classification
    getEnv("OPENAI_API_KEY"), // API key (ensure it's set)
    categories,
    (article: NewsExtractionResponse) => article.title // Use article titles as input
  );

  // Perform classification and group by category
  const groupedArticles = await classifier.groupByCategory(structuredNews);

  console.log(`Classification complete. Grouped into ${Object.keys(groupedArticles).length} categories.`);
  return groupedArticles;
}

/**
 * Processes and classifies news across multiple sources and labels.
 * Aggregates all results into a master category map and writes final output.
 * 
 * @param sourcesWithLabels - Mapping of source → label list (e.g., { bbc: ["breaking_news"] }).
 * @returns Master dictionary mapping each category to matched articles (with source info).
 */
async function processMultipleSources(sourcesWithLabels: { [source: string]: string[] }) {
  const ignored = await Bun.file("./src/ignore.json").json();
  const sites = await Bun.file("./src/sites.json").json();
  const categories = await Bun.file("./src/categories.json").json();

  const masterCategorizedData: { [category: string]: { title: string; link: string; source: string }[] } = {};

  for (const [source, labels] of Object.entries(sourcesWithLabels)) {
    const config = sites[source as Source];

    if (!config) {
      console.error(`Skipping: Site not found: ${source}`);
      continue;
    }

    for (const label of labels) {
      console.log(`Processing ${source} - ${label}...`);

      try {
        // Download and classify articles
        const structuredNews = await downloadAndExtract({
          cats: categories,
          ignored,
          label,
          config,
        });

        // Perform classification
        const classifiedArticles = await classifyNewsArticles(structuredNews, categories);

        // Accumulate into master set
        for (const [category, articles] of Object.entries(classifiedArticles)) {
          if (!masterCategorizedData[category]) {
            masterCategorizedData[category] = [];
          }
          articles.forEach((article) => {
            masterCategorizedData[category].push({
              title: article.title,
              link: article.link,
              source,
            });
          });
        }

        console.log(`✅ Finished processing: ${source} - ${label}`);
      } catch (error) {
        console.error(`❌ Error processing ${source} - ${label}:`, error);
      }
    }
  }

  console.log("🔥 All sources processed!");
  return masterCategorizedData;
}

const sourcesWithLabels = {
  aljazeera: ["breaking_news"],
  bbc: ["breaking_news"],
  apnews: ["breaking_news"],
  reuters: ["breaking_news"],
};

(async () => {
  const result = await processMultipleSources(sourcesWithLabels);
  await Bun.write(getJson("output.json"), JSON.stringify(result, null, 2));
})();



async function main() {

  const ignored = await Bun.file('./src/ignore.json').json()
  const sites = await Bun.file('./src/sites.json').json()
  const categories = await Bun.file('./src/categories.json').json()

  const args = process.argv.slice(2); // Skip the first two elements (bun and script name)

  if (args.length !== 2) {
    console.error("Usage: bun run your-script.ts <label> <source>");
    process.exit(1);
  }

  const [source, label] = args;

  const config = sites[source as Source];
  if (!config) {
    throw new Error(`Site not found: ${source}`);
  }  

  try {
    await downloadAndExtract({
      cats: categories,
      ignored,
      label,
      config,
    });
  } catch (err) {
    console.error("An error occurred:", err);
    process.exit(1);
  }
}


// main();
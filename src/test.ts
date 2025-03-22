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


export interface DownloadAndExtractArgs {
  cats: string[];
  ignored: string[];
  label: string;
  config: { selector: string, urls: { label: string; url: string; filename: string }[] };
}


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
 * Classifies news articles into predefined categories based on their titles.
 *
 * @param structuredNews - Array of news articles with at least a `title` property.
 * @param categories - Array of category labels to classify the articles.
 * @returns A Promise resolving to a `{ [category]: NewsExtractionResponse[] }` mapping.
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
  // console.log("📊 Final Categorized Results:", result);
})();


// main();

/**
 * Parses a Markdown document and splits it into structured sections based on 
 * underlined headers (e.g. `Some Title\n---` or `===`), using heuristics to 
 * distinguish between real section headings and incidental content.
 *
 * This function is designed for parsing long-form Markdown such as blog posts,
 * newsletters, or scraped articles that follow loose formatting conventions.
 *
 * A section is considered valid if:
 * - The title is 4 words or fewer, OR
 * - The title is fully uppercase
 *
 * Any content before the first valid section is treated as a "Breaking News" section.
 * Content following unqualified headers is merged into the last valid section.
 *
 * Slugs are generated for each valid section (lowercase, hyphenated, alphanumeric).
 *
 * @param {string} mdText - Raw Markdown input text, typically beginning with "Markdown Content:\n"
 *
 * @returns {Array<{ name: string; slug: string; content: string }>} 
 * An array of section objects, each with:
 *  - `name`: the section title as found in the header
 *  - `slug`: a URL-friendly identifier derived from the name
 *  - `content`: the Markdown content belonging to this section
 *
 * Example:
 * ```js
 * splitMarkdownSections(`# My Title\n---\nSome content`) 
 * // => [{ name: "My Title", slug: "my-title", content: "Some content" }]
 * ```
 */
export function splitMarkdownSections(mdText: string): { name: string; slug: string; content: string }[] {
  // Remove everything before "Markdown Content:\n"
  const startIndex = mdText.indexOf("Markdown Content:\n");
  if (startIndex !== -1) {
    mdText = mdText.slice(startIndex + "Markdown Content:\n".length).trim();
  }

  // Matches section headers followed by `---` or `===`
  const sectionRegex = /^(.*?[^\s])\n(?:-{3,}|={3,})$/gm;

  let match;
  let sections: { name: string; slug: string; content: string }[] = [];
  let lastIndex = 0;
  let firstMatchIndex: number | null = null;
  let previousContent = ""; // Holds content that is not a valid section
  let preFirstValidContent = ""; // Holds false positive sections before the first valid section

  while ((match = sectionRegex.exec(mdText)) !== null) {
    let sectionName = match[1].trim();
    const contentStart = match.index + match[0].length;

    // Store the index of the first detected section
    if (firstMatchIndex === null) {
      firstMatchIndex = match.index;
    }

    const nextMatch = sectionRegex.exec(mdText);
    sectionRegex.lastIndex = contentStart;

    // Extract the content between sections
    const content = nextMatch
      ? mdText.slice(contentStart, nextMatch.index).trim()
      : mdText.slice(contentStart).trim();

    // **Heuristic Check: Is this a REAL section or just an article headline?**
    const wordCount = sectionName.split(/\s+/).length;
    const isAllUppercase = sectionName === sectionName.toUpperCase();

    if (wordCount <= 4 || isAllUppercase) {
      // Generate slug (lower-cased and hyphenated)
      const slug = sectionName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "") // Remove special characters
        .replace(/\s+/g, "-") // Replace spaces with hyphens
        .replace(/-+/g, "-"); // Ensure no duplicate hyphens

      // **Before pushing a new section, merge previous leftover content**
      if (previousContent.trim() && sections.length > 0) {
        sections[sections.length - 1].content += `\n\n${previousContent}`;
        previousContent = "";
      }

      sections.push({ name: sectionName, slug, content });
    } else {
      // **If this is before the first real section, add it to Breaking News**
      if (firstMatchIndex === null) {
        preFirstValidContent += `\n\n${sectionName}\n${content}`;
      } else {
        // Otherwise, treat it as regular article content
        previousContent += `\n\n${sectionName}\n${content}`;
      }
    }
  }

  // **Handle missing intro/breaking news before the first section**
  if (firstMatchIndex !== null && firstMatchIndex > 0) {
    const introContent = mdText.slice(0, firstMatchIndex).trim();
    if (introContent || preFirstValidContent.trim()) {
      sections.unshift({
        name: "Breaking News",
        slug: "breaking-news",
        content: `${introContent}\n\n${preFirstValidContent}`.trim(),
      });
    }
  }

  // **If leftover content remains at the end, append it to the last section**
  if (previousContent.trim() && sections.length > 0) {
    sections[sections.length - 1].content += `\n\n${previousContent}`;
  }

  return sections;
}




/**
 * Fetches the raw HTML from a given URL and saves it to a local file.
 * 
 * This is typically used to cache remote content for offline analysis or 
 * post-processing workflows (e.g., HTML parsing, scraping, or content extraction).
 *
 * Note: This assumes you're running inside the Bun runtime, which allows 
 * file I/O and `fetch` natively.
 *
 * @param {string} url - The full URL to fetch HTML content from (must be HTTP/HTTPS).
 * @param {string} filename - The local file path where the HTML response will be saved.
 *
 * @returns {Promise<string>} - Resolves with the raw HTML text of the fetched page.
 *
 * @throws {Error} - If the HTTP response is not OK (non-2xx status).
 *
 * Example:
 * ```js
 * await fetchSite("https://example.com", "example.html");
 * ```
 */
export async function fetchSite(url: string, filename: string): Promise<string> {
  console.log(`Fetching from ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

  const html = await response.text();
  await Bun.write(filename, html); // Save locally
  return html;
}

/**
 * Reads a previously saved HTML file from the local filesystem.
 *
 * This function complements `fetchSite` and is used when you'd rather work
 * with a cached local copy of a site than re-fetch it on every run.
 *
 * Relies on Bun's file I/O API to read the contents of the file.
 *
 * @param {string} filename - The full file path to the HTML file to read.
 *
 * @returns {Promise<string>} - Resolves with the contents of the file as a string.
 *
 * Example:
 * ```js
 * const html = await readHtml("example.html");
 * ```
 */
export async function readHtml(filename: string): Promise<string> {
  console.log(`Reading from local file: ${filename}`);
  return await Bun.file(filename).text();
}
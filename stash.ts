
function splitMarkdownSections(mdText: string): { name: string; slug: string; content: string }[] {
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




// 🔹 Fetch and save HTML (disabled by default)
async function fetchSite(url: string, filename: string) {
  console.log(`Fetching from ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

  const html = await response.text();
  await Bun.write(filename, html); // Save locally
  return html;
}

// 🔹 Read HTML from a local file
async function readHtml(filename: string): Promise<string> {
  console.log(`Reading from local file: ${filename}`);
  return await Bun.file(filename).text();
}
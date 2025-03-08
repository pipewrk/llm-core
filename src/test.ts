import * as cheerio from "cheerio";

const AP_NEWS_URL = "https://apnews.com/";
const LOCAL_FILE = "apnews.html"; // Local storage for debugging

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

// 🔹 Extract articles using Cheerio
async function scrapeAPNews() {
    try {
        // 🔥 Toggle between fetching or reading local file
        // const html = await fetchSite(AP_NEWS_URL, LOCAL_FILE); // Uncomment to fetch live data
        const html = await readHtml(LOCAL_FILE); // Use local file

        // Load HTML into Cheerio
        const $ = cheerio.load(html);

        // 🔥 Select all articles using CSS selectors
        const articles = $(".PageList-items-item");

        if (articles.length === 0) {
            console.error("Error: No articles found.");
            return;
        }

        const results: Array<{ headline: string; link: string; imageUrl: string; description: string }> = [];

        articles.each((_, el) => {
            const article = $(el);

            const headline = article.find(".PagePromoContentIcons-text").text().trim() || "No headline";
            const link = article.find("a.Link").attr("href") || "No link";
            const imageUrl = article.find("img").attr("src") || "No image";
            const description = article.find(".PagePromo-description span").text().trim() || "No description";

            results.push({ headline, link, imageUrl, description });
        });

        console.log("Extracted Articles:", results);
    } catch (error) {
        console.error("Error processing AP News:", error instanceof Error ? error.message : error);
    }
}

// Run the scraper
scrapeAPNews();

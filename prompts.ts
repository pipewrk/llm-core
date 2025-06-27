import type {
  PromptShape,
  OptionsShape,
  NewsExtractionResponse,
  ArticleCountResponse,
  SingleQuestionResponse,
  QuestionsResponse,
  AnswerResponse,
  SnippetResponse,
  DirectiveResponse,
  TransformationDirectiveResponse,
} from "./src/types/prompts";

/**
 * Creates a prompt set for extracting structured news article data from Markdown content.
 *
 * The prompt guides a language model to extract valid articles, including title, link,
 * optional description, and optional image (with URL and caption).
 *
 * Designed for use with newsletter-style or scraped Markdown sources where structure is loose.
 *
 * @param {string} markdown - The raw Markdown content containing loosely structured news articles.
 * @param {number} articleCount - Estimated number of valid articles in the input (used as a hint).
 *
 * @returns {PromptShape<NewsExtractionResponse>} A structured prompt object ready for use with an LLM call.
 */
export function createNewsExtractionPrompt(
  markdown: string,
  articleCount: number
): PromptShape<NewsExtractionResponse> {
  const systemPrompt = `
  You are an intelligent parser that extracts structured data from markdown-based news headlines.
  Your output must always be in **valid JSON**. Ensure that all extracted links retain their associated text.
  If images are present, extract their URLs and their associated captions or context.
  If a description or summary is included, extract it.
  The output should always contain a list of extracted entries, even if only one entry exists.
  `;

  const userPrompt = `
   **Extraction Instructions**:
  1. This chunk contains approximately **${articleCount} articles** to extract.
  2. Extract **all news entries** with their associated **title, link, and optional description**.
  3. If an image is associated with an entry, extract its **URL** and **caption**.
  4. The response **must** be structured in JSON format.
  5. It is important you extract links and images as they appear in the content, do not parse or modify them.
  6. The image property need not be set if there is no image available.

  **Important Notes**:
  - If an entry has no image, return \`"image": null\`.
  - If an entry has no description, return \`"description": null\`.
  - If an entry is a subheading under another, ensure it's treated as an **individual article**.
  - Do **not** fabricate missing information. Only return what is explicitly present.
  - If a section contains duplicated content, only extract it once.
  
  **Markdown Content**:
  ${markdown}
  `;

  const options: OptionsShape<NewsExtractionResponse> = {
    schema_name: "news_extraction_schema",
    schema: {
      type: "object",
      required: ["articles"],
      properties: {
        articles: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "link"],
            properties: {
              title: { type: "string" },
              link: { type: "string" },
              description: { type: ["string", "null"] },
              image: {
                type: ["object", "null"],
                properties: {
                  url: { type: "string" },
                  caption: { type: "string" },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
      },
    },
  };

  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt set for counting the number of unique, valid news articles in Markdown.
 *
 * Valid articles must contain both a title and a link. Descriptions and images are optional.
 * The prompt is structured to instruct the LLM to return a JSON object with a single `article_count` integer.
 *
 * @param {string} markdown - The Markdown content to be scanned for valid article entries.
 *
 * @returns {PromptShape<ArticleCountResponse>}  - Prompt and schema for use in a counting task.
 */
export function createArticleCountPrompt(
  markdown: string
): PromptShape<ArticleCountResponse> {
  const systemPrompt = `
  You are an intelligent parser that analyzes markdown-based news headlines and extracts the number of unique articles present.
  Your task is to **accurately count** the number of valid articles in the provided markdown content.
  
  **Important Instructions**:
  - Only count **unique** articles (do not count duplicates).
  - A valid article must contain **a title and a link**.
  - Images and descriptions are **optional** and do not affect whether an entry is valid.
  - Ignore unrelated text, metadata, or section headings that do not represent actual articles.
  - Your response **must always be in valid JSON**.
  `;

  const userPrompt = `
  **Markdown Content**:
  ${markdown}

  **Counting Instructions**:
  1. Count the total number of **unique news articles** in the content.
  2. Each article must contain **a title and a valid link** to be counted.
  3. If an article appears more than once, count it **only once**.
  4. Do **not** count section headers, summaries, or standalone images unless they contain a news link.
  5. Your response **must be structured in JSON format** using the following schema:

  **JSON Schema**:
  \`\`\`json
  {
    "article_count": <number>
  }
  \`\`\`
  `;
  const options: OptionsShape<ArticleCountResponse> = {
    schema_name: "article_count_schema",
    schema: {
      type: "object",
      required: ["article_count"],
      properties: {
        article_count: { type: "integer", minimum: 0 },
      },
    },
  };

  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt for synthesising a single high-quality question from a cluster of semantically similar ones.
 *
 * Intended to de-duplicate and unify intent across multiple phrased questions.
 * The output format is strictly JSON with a single `question` string field.
 *
 * @param {string[]} cluster - A list of semantically similar user or AI-generated questions.
 * @param {string} context - Contextual text (e.g., documentation or passage) that the questions relate to.
 *
 * @returns {PromptShape<SingleQuestionResponse>};
 */
export function createSingleQnPrompt(
  cluster: string[],
  context: string
): PromptShape<SingleQuestionResponse> {
  const systemPrompt = "You are a concise and precise question generator.";
  const userPrompt = `Context: ${context}
These questions are semantically similar:
${cluster.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Combine these into one high-quality, brief, and concise question. Format the response as JSON with a 'question' field.`;

  const options: OptionsShape<SingleQuestionResponse> = {
    schema_name: "question_schema",
    schema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string" },
      },
    },
  };
  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt to generate multiple unique questions from a content section.
 *
 * Used to turn a block of content into insightful and varied questions. Differentiates
 * behaviour based on whether the input is release notes or general documentation.
 *
 * @param {string} section - The raw content to analyse and extract questions from.
 * @param {number} generationTarget - Exact number of questions to generate.
 * @param {boolean} isReleaseNotes - Whether the content is release notes (vs documentation).
 *
 * @returns {PromptShape<QuestionsResponse>} - Prompt and schema for use in bulk question generation.
 */
export function createSectionProcessingPrompt(
  section: string,
  generationTarget: number,
  isReleaseNotes: boolean
): PromptShape<QuestionsResponse> {
  const userPrompt = isReleaseNotes
    ? `Generate exactly ${generationTarget} unique questions from these release notes.
Focus on changes, features, improvements.
Format as JSON array with a 'question' field.
Content: ${section}`
    : `Generate exactly ${generationTarget} unique questions from this documentation.
Focus on key concepts, features, usage. The questions must be unique from each other and have depth about the context.
Format as JSON array with a 'question' field.
Content: ${section}`;

  const systemPrompt = isReleaseNotes
    ? `You are a helpful assistant generating questions about software release notes.`
    : `You are a helpful assistant generating questions about technical documentation.`;

  const options: OptionsShape<QuestionsResponse> = {
    schema_name: "questions_schema",
    schema: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            required: ["question"],
            properties: {
              question: { type: "string" },
            },
          },
        },
      },
    },
  };

  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt that generates an answer to a given question based on provided content.
 *
 * Instructs the AI to remain strictly within the bounds of the content, avoid hallucination,
 * and structure the response in Markdown within a valid JSON wrapper.
 *
 * @param {string} content - The reference content to base the answer on.
 * @param {string} question - The question being answered.
 * @param {number} totalQuestions - Total number of questions in the set (used for positional awareness).
 *
 * @returns {PromptShape<AnswerResponse>} - Fully structured prompt and expected response shape.
 */
export function createAnswerPrompt(
  content: string,
  question: string,
  totalQuestions: number
): PromptShape<AnswerResponse> {
  const systemPrompt = `You are a world class content expert, helping to answer questions based on the provided information.`;
  const userPrompt = `You are currently answering one out of ${totalQuestions} for the given content below. 
  **Instructions:
  1. You must answer the question as well as you can while staying within the bounds of the question. 
  2. If examples are requested, please include real-world examples relevant to the content.
  3. You cannot answer outside of the context of the content below.
  4. You can structure the answer using markdown syntax for clarity. (like headings, code blocks and bullets!)
  5. If the content doesn’t address the question, kindly respond with: "The content does not explicitly address this question."
  6. Do try to be concise but comprehensive
  7. Oh! And you have to format the **response as JSON** with an 'answer' field.
  ---
 
  **Question**: 
  ${question}
  ---

  **Content**:
  ${content}
  ---
  `;
  const options: OptionsShape<AnswerResponse> = {
    schema_name: "answer_schema",
    schema: {
      type: "object",
      required: ["answer"],
      properties: {
        answer: { type: "string" },
      },
    },
  };
  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt for extracting a standalone, contextually complete snippet that answers a question.
 *
 * The LLM is instructed to return the most relevant section of the content that matches the question,
 * without modifying or fabricating any part of it. Meant for precise quote extraction.
 *
 * @param {string} content - The original source text.
 * @param {string} question - The guiding question used to locate the relevant snippet.
 *
 * @returns {PromptShape<SnippetResponse>} - Prompt set and validation shape for snippet extraction tasks.
 */
export function createSnippetPrompt(
  content: string,
  question: string
): PromptShape<SnippetResponse> {
  const systemPrompt = `You are a sniper snippet extractor. You extract precise snippets from given content while ensuring they remain independently contextual.`;
  const userPrompt = `For the given question, please extract the single most relevant section of the original content that is relevant to the question.
  
  **Instructions**:
  1) You must extract the relevant section exactly as it is to preserve the authenticity of the original content.
  2) Please extract only one section which helps to answer the question asked.
  3) **Avoid redundancy**. If multiple sections convey the same information, select the most informative one related to the question.
  4) Oh, and don’t forget to format the **response as JSON** with a 'snippet' field.

  ---
  
  **Question**: 
  ${question}
  
  ---
  
  **Content**:
  ${content}
  ---
  `;
  const options: OptionsShape<SnippetResponse> = {
    schema_name: "snippet_schema",
    schema: {
      type: "object",
      required: ["snippet"],
      properties: {
        snippet: { type: "string" },
      },
    },
  };
  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt that transforms a piece of writing into a list of editorial-style directives.
 *
 * Designed to analyse tone, narrative voice, and authorial intent, and extract reusable,
 * prescriptive writing instructions from the text.
 *
 * @param {string} content - The article or excerpt to convert into writing directives.
 *
 * @returns {PromptShape<DirectiveResponse>} - A structured prompt and schema to extract writing directives.
 */
export function createDirectivePrompt(
  content: string
): PromptShape<DirectiveResponse> {
  const systemPrompt =
    "You are a discerning editor skilled in deconstructing text into actionable writing directives.";
  const userPrompt = `Analyse the following article and generate a list of writing directives that reflect the author's unique style, tone, and approach. The directives should be clear instructions such as "Write an engaging introduction about [topic]", "Create a detailed section on [concept]", or "Compose a witty conclusion summarising [theme]".

For example, consider this excerpt from one of the articles:
---
Article Excerpt Example:
"### What I do.

The way I see it? If you're going to clone a repo anyway, just use \`/srv\`. Here's what mine typically looks like:

\`\`\`plaintext
/srv/: tree -L 1
.
├── auth.example.com
├── blog.example.com
├── downloads.example.com
\`\`\`

In each directory, your web root can be named according to any convention you like \`webroot\`, \`public\` or simply just \`app\`. This directory is what you \`chgrp\` to \`www-data\`.

It's worth mentioning that the web root is not always needed, especially if you're using \`docker\` to manage the backend service."
---

A suitable directive for this excerpt might be:
"Write a detailed section explaining the benefits of using \`/srv\` over traditional web roots like \`/var/www/html\`, including practical examples and a discussion on security and organisation."

Now, please analyse the article below and generate similar actionable directives.

---
Article:
${content}
---

Format your response as JSON with a "directives" field that is an array of directive strings.`;

  const options: OptionsShape<DirectiveResponse> = {
    schema_name: "directive_schema",
    schema: {
      type: "object",
      required: ["directives"],
      properties: {
        directives: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  };

  return { systemPrompt, userPrompt, options };
}

/**
 * Creates a prompt for generating a creative directive to transform a piece of writing.
 *
 * Accepts a transformation goal (e.g., "make it humorous") and returns an actionable instruction
 * describing how to rework the original content in that style.
 *
 * @param {string} content - The original article excerpt to transform.
 * @param {string} transformation - A high-level instruction for transformation (e.g., poetic, humorous).
 *
 * @returns {PromptShape<TransformationDirectiveResponse>} - Prompt and schema to generate content transformation directives.
 */
export function createDirectiveForTransformationPrompt(
  content: string,
  transformation: string
): PromptShape<TransformationDirectiveResponse> {
  const systemPrompt =
    "You are a creative strategist skilled in reimagining existing content.";
  const userPrompt = `Based on the following article excerpt, generate a writing directive that instructs the creation of a transformed piece of content. The transformation should align with the instruction provided (e.g., "Create a humorous introduction" or "Develop a poetic summary").

For example, consider this excerpt from another article:
---
Article Excerpt Example:
"Meanwhile, the two of them were losing their minds, firing off ten million questions at me in rapid succession. I just smiled and said, “Keep at it.” Then I kept playing the guitar. Ten minutes in, after quietly observing their workflow, I finally spoke up.

“You’re solving one problem, and he’s solving another,” I said. “How do you know which fix worked and which one’s causing errors? It might feel like you’re slowing down, but just follow one simple rule: solve one problem at a time. No more, no less. Work together.”

The narrative uses humour and candid advice to transform a stressful debugging scenario into an engaging story."
---

Given a transformation instruction of "${transformation}", a suitable directive might be:
"Craft a humorous introduction that sets a lighthearted tone for a technical article by reimagining a high-pressure debugging scenario as a laid-back jam session."

Now, please generate a writing directive based on the excerpt below.

---
Transformation Instruction: ${transformation}

Article Excerpt:
${content}
---

Format your response as JSON with a "directive" field.`;

  const options: OptionsShape<TransformationDirectiveResponse> = {
    schema_name: "transformation_directive_schema",
    schema: {
      type: "object",
      required: ["directive"],
      properties: {
        directive: { type: "string" },
      },
    },
  };

  return { systemPrompt, userPrompt, options };
}

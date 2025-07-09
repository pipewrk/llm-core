import { test } from "bun:test";
import { OllamaService } from "../core/ollama-service.ts";
import { CosineDropChunker } from "../core/chunker.ts";
import { markdownSplitter } from "../core/markdown-splitter.ts";
import { MockLogger } from "./logger.mock.ts";

const logger = new MockLogger();

const fixtures = [
  {
    label: "txt",
    file: new URL("./fixtures/who-sea.txt", import.meta.url),
    out: "./chunks.ollama.txt.out.txt",
    mode: "text",
  },
  {
    label: "md",
    file: new URL("./fixtures/md-doc.md", import.meta.url),
    out: "./chunks.ollama.md.out.txt",
    mode: "markdown",
  },
];

const endpoint = "http://localhost:11434";
const model = "all-minilm:l6-v2";

const ollama = new OllamaService(model, endpoint);
const embedFn = (texts: string[]) => ollama.embedTexts(texts);

test("CosineDropChunker with Ollama embeddings (text + markdown)", async () => {
  const chunker = new CosineDropChunker(embedFn);
  (chunker as any).logger = logger;

  for (const { label, file, out, mode } of fixtures) {
    const raw = await Bun.file(file).text();

    const chunks =
      mode === "markdown"
        ? await chunker.chunk(raw, {
            bufferSize: 2,
            breakPercentile: 90,
            minChunkSize: 30,
            useHeadingsOnly: true,
            overlapSize: 0,
            type: "markdown",
          })
        : await chunker.chunk(raw, { bufferSize: 5, breakPercentile: 90 });

    const output = chunks
      .map((chunk, i) => `--- CHUNK ${i + 1} (${label}) ---\n${chunk.trim()}`)
      .join("\n\n");

    await Bun.write(out, output);
    console.log(`✅ ${label.toUpperCase()} → ${chunks.length} chunks → ${out}`);
  }
}, 1e6);

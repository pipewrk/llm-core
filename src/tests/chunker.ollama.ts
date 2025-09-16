import { it } from "bun:test";
import { createOllamaContext, embedTexts } from "../core/ollama-service.ts";
import { cosineDropChunker } from "../core/chunker.ts";
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

const svcCtx = createOllamaContext({ endpoint, model });
const embedFn = (texts: string[]) => embedTexts(svcCtx, texts);

it("CosineDropChunker with Ollama embeddings (text + markdown)", async () => {

  for (const { label, file, out, mode } of fixtures) {
    const raw = await Bun.file(file).text();

    const chunks =
      mode === "markdown"
        ? await cosineDropChunker({ logger, embed: embedFn, pipeline: { retries: 0, timeout: 0 } } as any, raw, {
            bufferSize: 2,
            breakPercentile: 90,
            minChunkSize: 30,
            useHeadingsOnly: true,
            overlapSize: 0,
            type: "markdown",
          })
        : await cosineDropChunker({ logger, embed: embedFn, pipeline: { retries: 0, timeout: 0 } } as any, raw, { bufferSize: 5, breakPercentile: 90 });

    const output = chunks
      .map((chunk: string, i: number) => `--- CHUNK ${i + 1} (${label}) ---\n${chunk.trim()}`)
      .join("\n\n");

    await Bun.write(out, output);
    console.log(`✅ ${label.toUpperCase()} → ${chunks.length} chunks → ${out}`);
  }
}, 1e6);


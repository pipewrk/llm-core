import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/core/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ["@huggingface/transformers", "onnxruntime-node", "onnxruntime-common"]
});

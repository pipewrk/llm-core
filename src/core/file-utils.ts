import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ILogger } from "../types/dataset.ts";
import { htmlToText } from "html-to-text";
import { parseDocument } from "htmlparser2";

/**
 * Converts HTML to plain text by parsing it and ignoring certain elements.
 *
 * If the input is valid HTML, it will be converted to readable plain text.
 * Otherwise, it will be returned as-is.
 *
 * @param input - The HTML string to convert
 * @returns The converted plain text string
 */
export function convertHtmlToPlainText(input: string): string {
  const isValidHtml = (html: string): boolean => {
    try {
      const doc = parseDocument(html);
      return doc.children.some(
        (node) => node.type === "tag" && node.name !== "html" // Ensure meaningful HTML tags
      );
    } catch {
      return false;
    }
  };

  // If valid HTML, convert it to readable plain text
  if (isValidHtml(input)) {
    return htmlToText(input, {
      wordwrap: false,
      selectors: [
        { selector: "pre", format: "block" }, // Preserve preformatted text
      ],
    });
  }

  // Return the original string if it's not valid HTML
  return input;
}

/**
 * Ensures that the specified directory exists, creating it if necessary.
 *
 * If the directory does not exist, it will be created, and a log message
 * will be recorded to indicate that the directory was created.
 *
 * @param dirPath - The path of the directory to ensure existence.
 * @param logger - Logger instance used to log information about directory creation.
 */

export function ensureDirectory(dirPath: string, logger: ILogger): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    logger.impt(`Created output directory: ${dirPath}`);
  }
}

/**
 * Reads the contents of a file at the specified path, returning the
 * contents as a string. This function assumes that the file exists,
 * and does not perform any error checking.
 *
 * @param filePath - The path of the file to read.
 * @returns The contents of the specified file as a string.
 */
export function readFileContents(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

/**
 * Saves an array of items as a JSONL file.
 *
 * The function takes a directory and filename as parameters, and
 * will create the file if it does not already exist. The items
 * array is expected to contain objects that can be serialized to
 * JSON. Each item in the array will be serialized and written to
 * the file on a separate line. The total number of items written
 * to the file is logged at the INFO level.
 *
 * @param directory - The directory where the output file should be written.
 * @param filename - The filename of the output file. If the filename does not
 *   end with '.jsonl', this suffix will be appended to the filename.
 * @param items - The array of items to write to the file.
 * @param logger - The logger instance used to log information about the file
 *   write operation.
 */
export function saveJsonl(
  directory: string,
  filename: string,
  items: unknown[],
  logger: ILogger
): void {
  let outputFile = filename.endsWith(".jsonl") ? filename : `${filename}.jsonl`;
  outputFile = directory ? join(directory, outputFile) : outputFile;
  const outputContent = items.map((item) => JSON.stringify(item)).join("\n");
  writeFileSync(outputFile, outputContent, "utf-8");
  logger.impt(`Saved ${items.length} item(s) to ${outputFile}`);
}

/**
 * Returns a list of files within a given directory.
 *
 * Optionally, a list of file extensions can be provided, and only files
 * with those extensions will be included in the returned list.
 *
 * @param directory - The path of the directory to read.
 * @param extensions - An optional list of file extensions to filter by.
 * @returns A list of file paths within the directory.
 */
export function getDirContents(
  directory: string,
  extensions: string[] = []
): string[] {
  const files = readdirSync(directory);
  return files
    .filter(
      (file) =>
        !extensions.length ||
        extensions.some((ext) => file.toLowerCase().endsWith(ext))
    )
    .map((file) => join(directory, file));
}

/**
 * Copies a single file from source to destination.
 *
 * This function creates the destination directory if necessary,
 * and copies the file from the source to the destination using
 * a stream. When the copy is finished, the returned promise is
 * resolved. If any error occurs during the copy, the promise is
 * rejected with that error.
 *
 * @param source - The path of the file to copy.
 * @param destination - The path where the file should be copied.
 * @returns A promise that resolves when the copy is finished.
 */
export function copyFile(source: string, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });

  const readStream = createReadStream(source);
  const writeStream = createWriteStream(destination);

  return new Promise((resolve, reject) => {
    readStream.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);
    readStream.pipe(writeStream);
  });
}

/**
 * Derives the QA file path from the given file path, appending `_qa.<extension>`.
 *
 * @param filePath - The path of the file to generate a QA path for.
 * @param extension - The file extension to use for the QA file.
 * @returns The QA file path.
 */
export function getQaPath(filePath: string, extension: string): string {
  const fileStem = basename(filePath, extname(filePath)) || "unknown";
  const dir = dirname(filePath) || ".";
  return join(dir, `${fileStem}_qa.${extension}`);
}

/**
 * Converts a JSON file to JSONL format.
 *
 * Reads a JSON file from the specified path, parses its contents,
 * and writes the data in JSONL format to another specified path.
 *
 * @param jsonPath - The path to the input JSON file.
 * @param jsonlPath - The path where the output JSONL file should be written.
 * @returns An array of the parsed items from the JSON file.
 */

export function convertJsonToJsonl(
  jsonPath: string,
  jsonlPath: string
): unknown[] {
  const content = readFileSync(jsonPath, "utf-8");
  const items = JSON.parse(content);

  const output = items
    .map((item: Record<string, unknown>) => JSON.stringify(item))
    .join("\n");
  writeFileSync(jsonlPath, output, "utf-8");
  return items;
}

/**
 * Reads a JSONL file and returns the array of questions it contains.
 * Skips empty lines and trims the lines before parsing them.
 * @param filePath the path to the JSONL file
 * @returns an array of objects
 */
export function readJsonlFile(filePath: string): unknown[] {
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Checks if there's an existing QA file (JSON or JSONL) that meets
 * the min number of objects. Converts JSON to JSONL if needed.
 *
 * @param filePath - The path of the source file.
 * @param requiredQuestions - The minimum number of objects required.
 *
 * @returns The array of objects that was found (or null if not found)
 */
export function checkExistingQa(
  filePath: string,
  requiredQuestions: number
): unknown[] | null {
  const qaPaths = [
    { path: getQaPath(filePath, "jsonl"), isJsonl: true },
    { path: getQaPath(filePath, "json"), isJsonl: false },
  ];

  for (const { path, isJsonl } of qaPaths) {
    if (existsSync(path)) {
      const items = isJsonl
        ? readJsonlFile(path)
        : JSON.parse(readFileSync(path, "utf-8"));

      if (items.length >= requiredQuestions) {
        if (!isJsonl) {
          convertJsonToJsonl(path, getQaPath(filePath, "jsonl"));
        }
        return items;
      }
    }
  }
  return null;
}

/**
 * Parses a directory to find content files and their associated `.jsonl` files.
 *
 * Content files are assumed to have a `.md` extension (or similar), and their
 * associated `.jsonl` files are identified based on the same base name.
 *
 * @param directory - The output directory to parse.
 * @param logger - Logger instance for logging information.
 * @returns An array of objects, each containing:
 *   - `fileName`: The full path to the content file.
 *   - `jsonl`: The full path to the associated `.jsonl` file.
 *
 * @example
 * Output:
 * ```json
 * [
 *   { "fileName": "./output/1. Introduction.md", "jsonl": "./output/1. Introduction.md.jsonl" },
 *   { "fileName": "./output/2. Core Principles.md", "jsonl": "./output/2. Core Principles.md.jsonl" }
 * ]
 * ```
 */
export function getParsedOutputFiles(
  directory: string,
  logger: ILogger
): { fileName: string; jsonl: string }[] {
  const files = getDirContents(directory, ["md", "txt"]);
  const jsonlFiles = getDirContents(directory, ["jsonl"]);

  // Map JSONL files for quick lookup
  const jsonlFileMap = new Map<string, string>(
    jsonlFiles.map((file) => [basename(file, ".md.jsonl"), file])
  );

  // Pair content files with their associated JSONL files
  const results = files
    .map((fileName) => {
      const baseName = basename(fileName, extname(fileName));
      const jsonl = jsonlFileMap.get(baseName);
      if (!jsonl) {
        logger.warn(`No JSONL file found for content file: ${fileName}`);
        return null; // Exclude files without matching JSONL files
      }

      return { fileName, jsonl };
    })
    .filter(
      (entry): entry is { fileName: string; jsonl: string } => entry !== null
    );

  logger.impt(
    `Found ${results.length} content files with associated JSONL files in directory: ${directory}`
  );

  return results;
}

/**
 * Processes the content files and their associated `.jsonl` files in a directory.
 *
 * Uses the `.jsonl` file path as a unique identifier.
 *
 * @param directory - The directory containing the files to process.
 * @param logger - Logger instance for logging information.
 * @returns An array of objects, each containing:
 *   - `identifier`: The full path to the `.jsonl` file (unique identifier).
 *   - `content`: The content of the associated markdown or text file.
 *   - `jsonData`: An array of parsed objects from the `.jsonl` file.
 *
 * @example
 * Output:
 * ```json
 * [
 *   {
 *     "identifier": "./output/1. Introduction.md.jsonl",
 *     "content": "The introduction text content...",
 *     "jsonData": [
 *       { "question": "What is the purpose of the introduction?", ... },
 *       { "question": "How does this section connect to the next?", ... }
 *     ]
 *   },
 *   {
 *     "identifier": "./output/2. Core Principles.md.jsonl",
 *     "content": "The core principles text content...",
 *     "jsonData": [
 *       { "question": "What are the core principles discussed?", ... },
 *       { "question": "Why are these principles important?", ... }
 *     ]
 *   }
 * ]
 * ```
 */
export function processParsedFiles<T>(
  directory: string,
  logger: ILogger
): { identifier: string; content: string; jsonData: T[] }[] {
  // Step 1: Get parsed output files
  const parsedFiles = getParsedOutputFiles(directory, logger);

  // Step 2: Process each file's content and associated JSONL
  return parsedFiles.map(({ fileName, jsonl }) => {
    const content = readFileContents(fileName);
    const jsonData = readJsonlFile(jsonl) as T[]; // Ensure jsonData conforms to T[]
    logger.impt(`Processed file: ${fileName} with JSONL: ${jsonl}`);
    return { identifier: jsonl, content, jsonData };
  });
}

/**
 * Removes a file at the given file path.
 *
 * @param filePath - The full path to the file to remove.
 * @param logger - Logger instance for logging information.
 * @returns `true` if the file is successfully removed, `false` otherwise.
 */
export function removeFile(filePath: string, logger: ILogger): boolean {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return true;
  } catch (error) {
    logger.error(`Failed to remove file at: ${filePath}`, error);
    return false;
  }
}

/**
 * Prepares a FormData object for API requests that accept file uploads.
 *
 * The 'purpose' field is set to 'batch', and the file stream is appended to the form.
 *
 * @param filePath - The full path to the file to upload.
 * @returns A FormData object with the 'purpose' and 'file' fields set.
 */
export function prepareFormData(filePath: string): FormData {
  const formData = new globalThis.FormData();
  formData.append("purpose", "batch");

  if (typeof Bun !== "undefined") {
    formData.append("file", Bun.file(filePath));
    return formData;
  }

  //@ts-expect-error
  if (typeof Deno !== "undefined") {
    //@ts-expect-error
    formData.append("file", Deno.readFileSync(filePath));
    return formData;
  }

  if (typeof process !== "undefined") {
    const { createReadStream } = require("fs");
    formData.append("file", createReadStream(filePath));
    return formData;
  }

  throw new Error("Unsupported runtime for file uploads");
}

/**
 * Fetches JSON data from a specified URL.
 *
 * Sends an HTTP request to the given URL with the provided options
 * and returns the response data parsed as JSON.
 *
 * @template T - The expected type of the JSON response.
 * @param url - The URL to send the request to.
 * @param options - The options to configure the request, such as
 * headers and method.
 * @returns A Promise that resolves to the parsed JSON object.
 * @throws An Error if the HTTP response status is not OK.
 */

export async function fetchJson<T>(
  url: string,
  options: RequestInit
): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(
      `Fetch failed with status ${res.status}: ${res.statusText}`
    );
  }

  return res.json() as Promise<T>;
}

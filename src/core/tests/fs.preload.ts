import { mock } from "bun:test";

// We replace some of Node’s fs functions with mocks.
// Adjust the implementations so they behave in a way that makes sense for your tests.
// For example, if you call lstatSync on a path that looks like it’s a file, we return a fake stats object.
mock.module("fs", () => ({
  writeFileSync: mock((filePath: string, content: string, encoding: string) => {
    // Simply record the call. You might want to store a copy
    // in an in-memory object if your tests need to inspect file contents.
    console.log(`writeFileSync(${filePath}, ..., ${encoding})`);
  }),
  readdirSync: mock((dir: string, opts?: any) => {
    // Customize the behavior based on the directory
    if (dir === "./input") {
      return [
        { name: "file1.txt", isFile: () => true, isDirectory: () => false },
        { name: "subdir", isFile: () => false, isDirectory: () => true },
      ];
    }
    if (dir === "./input/subdir") {
      return [{
        name: "nested.txt",
        isFile: () => true,
        isDirectory: () => false,
      }];
    }
    return [];
  }),
  readFileSync: mock((filePath: string, encoding: string) => {
    console.log(`readFileSync(${filePath}, ${encoding})`);
    // Return file contents from our in-memory object, or an empty string if not found.
    // return inMemoryFiles[filePath] || "";
  }),
  lstatSync: mock((p: string) => {
    // Adjust the fake implementation based on the path:
    if (
      p.includes("file.txt") || p.includes("file1.txt") ||
      p.includes("nested.txt")
    ) {
      return { isFile: () => true, isDirectory: () => false };
    }
    if (p.includes("source") && !p.includes(".")) {
      // if it is a directory
      return { isFile: () => false, isDirectory: () => true };
    }
    return { isFile: () => false, isDirectory: () => false };
    // Default (this should not be reached in tests)
  }),
  existsSync: mock((p: string) => true),
  mkdirSync: mock((dir: string, options?: any) => {
    console.log(
      `mkdirSync(${dir}${options ? `, ${JSON.stringify(options)}` : ""})`,
    );
    // Simply simulate that the directory is created. In a more advanced implementation,
    // you might track created directories in an in-memory object.
  }),
  // Add mocks for createReadStream and createWriteStream.
  createReadStream: mock((filePath: string, options?: any) => {
    console.log(`createReadStream(${filePath}, ${JSON.stringify(options)})`);
    return {
      on: mock((event: string, cb: () => void) => {
        console.log(`createReadStream: ${event} called`);
      }),
    };
  }),
  createWriteStream: mock((filePath: string, options?: any) => {
    console.log(`createWriteStream(${filePath}, ${JSON.stringify(options)})`);
    return {
      on: mock((event: string, cb: () => void) => {
        console.log(`createWriteStream: ${event} called`);
      }),
    };
  }),
}));

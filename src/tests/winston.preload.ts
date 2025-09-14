import { mock } from "bun:test";

// Minimal winston mock to capture logs without touching real transports
type Captured = { level: string; message: string };
const captured: Captured[] = [];

const defaultExport = {
  captured,
  addColors: mock((_colors: Record<string, string>) => {}),
  transports: {
    File: function File(this: any, _opts: any) {},
    Console: function Console(this: any, _opts: any) {},
  },
  format: {
    combine: (..._args: any[]) => ({}),
    timestamp: () => ({}),
    printf: (_fn: any) => ({}),
  },
  createLogger: mock((_opts: any) => ({
    log: ({ level, message }: { level: string; message: string }) => {
      captured.push({ level, message });
    },
    error: (msg: unknown) => {
      const message = typeof msg === "string" ? msg : (msg as any)?.message ?? String(msg);
      captured.push({ level: "error", message });
    },
  })),
};

// Expose as the default export of the module
mock.module("winston", () => ({ default: defaultExport }));

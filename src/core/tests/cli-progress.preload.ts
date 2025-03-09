import { mock } from "bun:test";
import { EventEmitter } from "events";

/**
 * FakeSingleBar simulates a progress bar.
 */
class FakeSingleBar {
  total: number;
  value: number;
  payload: any;
  options: any;
  stopped: boolean = false;

  constructor(total: number, startValue: number, payload?: any, options?: any) {
    this.total = total;
    this.value = startValue;
    this.payload = payload;
    this.options = options;
  }

  start = mock(() => {
    // Log or record that start was called if needed.
  });

  update = mock((value: number, payload?: any) => {
    this.value = value;
    if (payload !== undefined) {
      this.payload = payload;
    }
  });

  stop = mock(() => {
    this.stopped = true;
  });

  setTotal = mock((total: number) => {
    this.total = total;
    return total;
  });

  increment = mock((incr: number, payload?: any) => {
    this.value += incr;
    if (payload !== undefined) {
      this.payload = payload;
    }
  });
}

/**
 * FakeMultiBar simulates the MultiBar from cli-progress.
 * It extends EventEmitter and stores created bars.
 */
export class FakeMultiBar extends EventEmitter {
  options: any;
  preset: any;
  isActive: boolean = true;
  createdBars: FakeSingleBar[] = [];

  constructor(opt: any, preset?: any) {
    super();
    this.options = opt;
    this.preset = preset;
    // Expose this fake instance on the global for tests.
    (globalThis as any).__cliProgressInstance__ = this;
  }

  create = mock(
    (
      total: number,
      startValue: number,
      payload?: any,
      barOptions?: any,
    ): FakeSingleBar => {
      const bar = new FakeSingleBar(total, startValue, payload, barOptions);
      this.createdBars.push(bar);
      return bar;
    },
  );

  remove = mock((bar: FakeSingleBar): boolean => {
    const idx = this.createdBars.indexOf(bar);
    if (idx >= 0) {
      this.createdBars.splice(idx, 1);
      return true;
    }
    return false;
  });

  update = mock(() => {
    // Simulate internal update routine if needed.
  });

  stop = mock(() => {
    // Stop all bars
    this.createdBars.forEach((bar) => bar.stop());
    this.isActive = false;
  });

  log = mock((data: string) => {
    console.log(data);
  });
}

export const Presets = {
  shades_grey: {}, // Minimal preset
};

// Export FakeMultiBar as MultiBar so that any import of "cli-progress" will receive this.
export { FakeMultiBar as MultiBar };

mock.module("cli-progress", () => ({
  default: {
    MultiBar: FakeMultiBar,
    Presets: {
      shades_grey: {
        barCompleteChar: "",
        barIncompleteChar: "",
      },
    },
  },
}));

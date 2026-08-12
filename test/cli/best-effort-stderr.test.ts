import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { bestEffortStderrWriter } from "../../src/cli/bestEffortStderr.js";

describe("best-effort stderr", () => {
  it("absorbs asynchronous stream errors and synchronous write failures", () => {
    const stream = new EventEmitter() as EventEmitter & {
      write: (message: string) => boolean;
    };
    stream.write = () => {
      throw new Error("stderr unavailable");
    };
    const write = bestEffortStderrWriter(stream);

    expect(() => stream.emit("error", new Error("broken pipe"))).not.toThrow();
    expect(() => write("Progress\n")).not.toThrow();
  });
});

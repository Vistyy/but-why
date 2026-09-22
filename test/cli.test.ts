import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

describe("review CLI argument boundary", () => {
  it("rejects unknown modes before Git or model execution", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runCli(["review", "task"])).resolves.toBe(1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

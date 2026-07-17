import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    isolate: false,
    maxWorkers: 4,
    minWorkers: 4,
    pool: "threads",
  },
});

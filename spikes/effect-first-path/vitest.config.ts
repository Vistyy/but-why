import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["effect-first-path.probe.ts"],
  },
});

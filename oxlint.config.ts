import { defineConfig } from "oxlint";
import config from "@syzom/typescript-quality/oxlint/effect";

export default defineConfig({
  ...config,
  ignorePatterns: ["dist/**", "coverage/**"],
});

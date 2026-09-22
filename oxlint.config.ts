import config from "@syzom/typescript-quality/oxlint/effect";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...config,
  ignorePatterns: ["dist/**", "coverage/**"],
  overrides: [
    {
      files: ["test/**/*.ts"],
      rules: {
        "effecttsgo/async-function": "off",
        "effecttsgo/global-timers": "off",
        "effecttsgo/new-promise": "off",
        "effecttsgo/process-env": "off",
      },
    },
    {
      files: ["src/piReviewer.ts"],
      rules: { "effecttsgo/async-function": "off" },
    },
  ],
});

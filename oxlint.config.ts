import config from "@syzom/typescript-quality/oxlint/effect";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...config,
  ignorePatterns: ["dist/**", "coverage/**"],
  overrides: [
    {
      files: ["test/**/*.ts"],
      // Tests exercise native Promise and AbortSignal behavior at the reviewer boundary.
      rules: {
        "effecttsgo/async-function": "off",
        "effecttsgo/global-timers": "off",
        "effecttsgo/new-promise": "off",
        "effecttsgo/process-env": "off",
      },
    },
    {
      files: ["src/piReviewer.ts"],
      // The Pi SDK exposes a Promise API; Effect owns its lifecycle in reviewers.ts.
      rules: { "effecttsgo/async-function": "off" },
    },
  ],
});

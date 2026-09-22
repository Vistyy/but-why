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
    {
      files: ["src/config.ts", "src/rules.ts"],
      rules: { "anti-slop/no-unknown-parameters": "off" },
    },
    {
      files: ["src/git.ts"],
      rules: { "effecttsgo/global-timers-in-effect": "off" },
    },
    {
      files: ["src/cli.ts"],
      rules: { "effecttsgo/global-console": "off" },
    },
  ],
});

import { rm } from "node:fs/promises";
import { rolldown } from "rolldown";

await rm("dist", { recursive: true, force: true });
const bundle = await rolldown({
  input: "src/main.ts",
  platform: "node",
  // Pi owns runtime-relative OAuth modules that must resolve from its installed package.
  external: ["@earendil-works/pi-coding-agent"],
});
await bundle.write({
  dir: "dist",
  format: "esm",
  minify: true,
  sourcemap: true,
});
await bundle.close();

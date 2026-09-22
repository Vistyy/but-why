import { chmod, rm } from "node:fs/promises";
import { rolldown } from "rolldown";

await rm("dist", { recursive: true, force: true });
const bundle = await rolldown({
  input: "src/main.ts",
  platform: "node",
  external: ["@earendil-works/pi-coding-agent"],
});
await bundle.write({ dir: "dist", format: "esm", minify: true });
await bundle.close();
await chmod("dist/main.js", 0o755);

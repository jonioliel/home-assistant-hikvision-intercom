import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const PANEL_OUTFILE = "../custom_components/hikvision_intercom/frontend/panel.js";
const AUDIO_WORKLET_OUTFILE = "../custom_components/hikvision_intercom/frontend/audio-worklet.js";
await build({
  entryPoints: ["src/panel.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: PANEL_OUTFILE,
  legalComments: "external",
  sourcemap: false,
});

await build({
  entryPoints: ["src/audio-worklet.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: AUDIO_WORKLET_OUTFILE,
  sourcemap: false,
});

for (const outfile of [PANEL_OUTFILE, AUDIO_WORKLET_OUTFILE]) {
  const generated = await readFile(outfile, "utf8");
  await writeFile(outfile, generated.replace(/[ \t]+(?=\r?\n)/g, ""), "utf8");
}

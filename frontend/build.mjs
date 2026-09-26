import { build } from "esbuild";
await build({
  entryPoints: ["src/panel.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: "../custom_components/smplwise_access_control/frontend/panel.js",
  legalComments: "external",
  sourcemap: false,
});

await build({
  entryPoints: ["src/audio-worklet.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: "../custom_components/smplwise_access_control/frontend/audio-worklet.js",
  sourcemap: false,
});

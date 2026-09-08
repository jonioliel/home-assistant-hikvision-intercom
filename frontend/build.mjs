import { build } from "esbuild";
await build({
  entryPoints: ["src/panel.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: "../custom_components/hikvision_intercom/frontend/panel.js",
  legalComments: "external",
  sourcemap: false,
});

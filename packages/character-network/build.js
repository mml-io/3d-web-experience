import esbuild from "esbuild";
import { dtsPlugin } from "esbuild-plugin-d.ts";















const buildOptions = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  outdir: "build",
  target: "es2020",
  platform: "node",
  packages: "external",
  sourcemap: true,
  loader: {},
  plugins: [dtsPlugin()],
};















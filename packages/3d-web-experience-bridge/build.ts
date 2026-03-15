import * as esbuild from "esbuild";

import { dtsPlugin } from "../../utils/dtsPlugin";
import { rebuildOnDependencyChangesPlugin } from "../../utils/rebuildOnDependencyChangesPlugin";

const buildMode = "--build";
const watchMode = "--watch";

const helpString = `Mode must be provided as one of ${buildMode} or ${watchMode}`;

const args = process.argv.splice(2);

if (args.length !== 1) {
  console.error(helpString);
  process.exit(1);
}

const mode = args[0];

const shared: esbuild.BuildOptions = {
  write: true,
  bundle: true,
  format: "esm",
  outdir: "build",
  platform: "node",
  packages: "external",
  sourcemap: true,
  target: "node20",
};

// Library entries — generates .d.ts files
const libraryBuildOptions: esbuild.BuildOptions = {
  ...shared,
  entryPoints: {
    index: "src/index.ts",
    interactive: "src/interactive.ts",
    "node-polyfills": "src/node-polyfills.ts",
    "navmesh-worker": "src/navmesh-worker.ts",
  },
  metafile: true,
  plugins: [
    mode === watchMode ? rebuildOnDependencyChangesPlugin() : null,
    dtsPlugin(),
  ].filter(Boolean) as esbuild.Plugin[],
};

// CLI entry — adds shebang, no .d.ts.
// ./index must be external so the dynamic import("./index") stays deferred;
// otherwise esbuild inlines it and its static imports (which need DOM polyfills)
// get hoisted before the polyfill setup code runs.
const cliBuildOptions: esbuild.BuildOptions = {
  ...shared,
  entryPoints: { cli: "src/cli.ts" },
  external: ["./index.js", "./interactive.js", "./node-polyfills.js"],
  banner: { js: "#!/usr/bin/env node" },
  plugins: [
    mode === watchMode ? rebuildOnDependencyChangesPlugin() : null,
  ].filter(Boolean) as esbuild.Plugin[],
};

switch (mode) {
  case buildMode:
    Promise.all([esbuild.build(libraryBuildOptions), esbuild.build(cliBuildOptions)]).catch(() =>
      process.exit(1),
    );
    break;
  case watchMode:
    Promise.all([
      esbuild.context(libraryBuildOptions).then((context) => context.watch()),
      esbuild.context(cliBuildOptions).then((context) => context.watch()),
    ]).catch(() => process.exit(1));
    break;
  default:
    console.error(helpString);
}

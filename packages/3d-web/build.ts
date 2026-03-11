import * as esbuild from "esbuild";
import { copy } from "esbuild-plugin-copy";

const buildMode = "--build";
const watchMode = "--watch";

const helpString = `Mode must be provided as one of ${buildMode} or ${watchMode}`;

const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error(helpString);
  process.exit(1);
}

const mode = args[0];

// CLI build options (Node.js executable)
const cliBuildOptions: esbuild.BuildOptions = {
  entryPoints: ["src/index.ts"],
  write: true,
  bundle: true,
  format: "esm",
  outdir: "build",
  platform: "node",
  packages: "external",
  sourcemap: true,
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
};

// Client build options (browser bundle)
const clientBuildOptions: esbuild.BuildOptions = {
  entryPoints: {
    index: "src/client/index.ts",
  },
  bundle: true,
  write: true,
  metafile: true,
  sourcemap: "linked",
  minify: true,
  outdir: "./build/client/",
  assetNames: "[dir]/[name]-[hash]",
  preserveSymlinks: true,
  loader: {
    ".svg": "file",
    ".png": "file",
    ".jpg": "file",
    ".glb": "file",
    ".hdr": "file",
  },
  outbase: ".",
  sourceRoot: "./src/client",
  publicPath: "/web-client/",
  plugins: [
    copy({
      resolveFrom: "cwd",
      assets: {
        from: ["./src/client/public/**/*"],
        to: ["./build/client/"],
      },
    }),
  ],
};

switch (mode) {
  case buildMode:
    await Promise.all([esbuild.build(cliBuildOptions), esbuild.build(clientBuildOptions)]).catch(
      () => process.exit(1),
    );
    break;
  case watchMode:
    await Promise.all([
      esbuild.context(cliBuildOptions).then((context) => context.watch()),
      esbuild.context(clientBuildOptions).then((context) => context.watch()),
    ]).catch(() => process.exit(1));
    break;
  default:
    console.error(helpString);
}

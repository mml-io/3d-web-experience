import { execSync } from "child_process";

import chokidar from "chokidar";
import { concurrently } from "concurrently";
import esbuild from "esbuild";
import CssModulesPlugin from "esbuild-css-modules-plugin";
import svgr from "esbuild-plugin-svgr";

const buildMode = "--build";
const watchMode = "--watch";

const helpString = `Mode must be provided as one of ${buildMode} or ${watchMode}`;

const buildOptions = {
  entryPoints: {
    index: "src/index.tsx",
  },
  bundle: true,
  external: ["node:crypto"],
  write: true,
  publicPath: "/",
  sourcemap: true,
  outdir: "build",
  format: "esm",
  plugins: [
    CssModulesPlugin({
      inject: true,
    }),
    svgr(),
  ],
};

const args = process.argv.splice(2);

if (args.length !== 1) {
  console.error(helpString);
  process.exit(1);
}

const mode = args[0];

function rebuildOnChange() {
  esbuild.build(buildOptions).catch(() => process.exit(1));
}

switch (mode) {
  case buildMode: {
    execSync("tsc --emitDeclarationOnly", { stdio: "inherit" });
    esbuild.build(buildOptions).catch(() => process.exit(1));
    break;
  }
  case watchMode: {
    const cssWatcher = chokidar.watch("src/**/*.css", {
      ignored: /node_modules/,
      persistent: true,
    });
    cssWatcher.on("change", (path) => {
      console.log(`CSS changed: ${path}`);
      rebuildOnChange();
    });

    const tsWatcher = chokidar.watch(["src/**/*.ts", "src/**/*.tsx"], {
      ignored: /node_modules/,
      persistent: true,
    });
    tsWatcher.on("change", (path) => {
      console.log(`TypeScript file changed: ${path}`);
      rebuildOnChange();
    });

    concurrently([
      {
        command: "tsc --emitDeclarationOnly --watch --preserveWatchOutput",
        name: "tsc",
        prefixColor: "blue",
      },
      {
        command: "node ./build.js --build",
        name: "esbuild-init",
        prefixColor: "yellow",
      },
    ]);
    break;
  }
  default: {
    console.error(helpString);
    process.exit(1);
  }
}

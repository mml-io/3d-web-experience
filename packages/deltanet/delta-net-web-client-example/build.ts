import { createRequire } from "node:module";

import { spawn } from "child_process";
import * as esbuild from "esbuild";
import { PluginBuild } from "esbuild";
import CssModulesPlugin from "esbuild-css-modules-plugin";
import kill from "tree-kill";

let runningProcess: ReturnType<typeof spawn> | undefined;

const buildMode = "--build";
const watchMode = "--watch";

const helpString = `Mode must be provided as one of ${buildMode} or ${watchMode}`;

const args = process.argv.splice(2);

if (args.length !== 1) {
  console.error(helpString);
  process.exit(1);
}

const mode = args[0];

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ["src/index.ts"],
  outdir: "./build/server/",
  bundle: true,
  format: "esm",
  metafile: true,
  packages: "external",
  sourcemap: "inline",
  platform: "node",
  target: "es2020",
  loader: {
    ".html": "text",
  },
  plugins: [
    CssModulesPlugin({
      inject: true,
      emitDeclarationFile: true,
    }),
    ...(mode === watchMode
      ? [
          {
            name: "watch-dependencies",
            setup(build: PluginBuild) {
              build.onResolve({ filter: /.*/ }, (args) => {
                // Include dependent packages in the watch list
                if (args.kind === "import-statement") {
                  if (!args.path.startsWith(".")) {
                    const require = createRequire(args.resolveDir);
                    let resolved;
                    try {
                      resolved = require.resolve(args.path);
                    } catch {
                      return;
                    }
                    return {
                      external: true,
                      watchFiles: [resolved],
                    };
                  }
                }
              });
              build.onEnd(async () => {
                console.log("Build finished. (Re)starting process");
                if (runningProcess) {
                  const proc = runningProcess;
                  await new Promise<void>((resolve) => {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    kill(proc.pid!, "SIGTERM", () => {
                      resolve();
                    });
                  });
                }
                runningProcess = spawn("npm", ["run", "start-server"], {
                  stdio: "inherit",
                });
              });
            },
          },
        ]
      : []),
  ],
};

switch (mode) {
  case buildMode:
    esbuild.build(buildOptions).catch(() => process.exit(1));
    break;
  case watchMode:
    esbuild
      .context({ ...buildOptions })
      .then((context) => context.watch())
      .catch(() => process.exit(1));
    break;
  default:
    console.error(helpString);
}

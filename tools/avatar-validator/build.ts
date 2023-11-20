import fs from "fs";

import * as esbuild from "esbuild";

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
  entryPoints: {
    index: "src/index.ts",
  },
  bundle: true,
  write: true,
  sourcemap: "inline",
  outdir: "./build/",
  preserveSymlinks: true,
  loader: {
    ".svg": "base64",
    ".png": "base64",
    ".jpg": "base64",
    ".glb": "base64",
    ".hdr": "base64",
  },
  outbase: "../",
  sourceRoot: "./src",
  plugins: [
    {
      name: "example",
      setup(build) {
        build.onEnd((result) => {
          const htmlAsText = fs.readFileSync("./src/index.html");
          const scriptAsText = fs.readFileSync("./build/index.js");

          const replacementLine = `<script src="TO_REPLACE_AT_BUILD" type="module"></script>`;
          const index = htmlAsText.indexOf(replacementLine);
          if (index === -1) {
            throw new Error("Failed to find replacement line");
          }
          const replacedHtml =
            htmlAsText.subarray(0, index) +
            `<script>${scriptAsText}</script>` +
            htmlAsText.subarray(index + replacementLine.length);
          fs.mkdirSync("./build", { recursive: true });
          fs.writeFileSync("./build/index.html", replacedHtml);
        });
      },
    },
  ],
};

switch (mode) {
  case buildMode:
    esbuild.build(buildOptions).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case watchMode:
    esbuild
      .context(buildOptions)
      .then((context) => context.watch())
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
    break;
  default:
    console.error(helpString);
}

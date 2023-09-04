import * as path from "path";

import { handleLibraryBuild } from "../../utils/build-library";

const cssModulesPlugin = require("esbuild-css-modules-plugin");

handleLibraryBuild(
  [
    cssModulesPlugin({
      cssModulesOption: {
        root: path.sep === "\\" ? "." : "",
      },
      inject: true,
    }),
  ],
  {
    ".svg": "text",
  },
);

import * as path from "path";

import cssModulesPlugin from "esbuild-css-modules-plugin";

import { handleLibraryBuild } from "../../utils/build-library";

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

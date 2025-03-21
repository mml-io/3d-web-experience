// @ts-ignore
import CssModulesPlugin from "esbuild-css-modules-plugin";

import { handleLibraryBuild } from "../../utils/build-library";

handleLibraryBuild({
  plugins: [
    CssModulesPlugin({
      inject: true,
      emitDeclarationFile: true,
    }),
  ],
  loader: {
    ".svg": "text",
  },
});

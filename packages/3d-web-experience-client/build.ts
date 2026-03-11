import { handleLibraryBuild } from "../../utils/build-library";

handleLibraryBuild({
  entryPoints: {
    index: "src/index.ts",
  },
  platformOverride: "browser",
  loader: {
    ".svg": "text",
  },
});

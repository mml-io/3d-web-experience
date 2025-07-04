import { handleLibraryBuild } from "../../utils/build-library";
import { workerPlugin } from "../../utils/workerPlugin";

handleLibraryBuild({
  plugins: [workerPlugin()],
  platformOverride: "browser",
  loader: {
    ".glb": "dataurl",
  },
});

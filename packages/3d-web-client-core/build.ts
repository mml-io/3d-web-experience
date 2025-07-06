import { handleLibraryBuild } from "../../utils/build-library";
import { workerPlugin } from "../../utils/workerPlugin";
import { base64Plugin } from "../../utils/base64Plugin";

handleLibraryBuild({
  plugins: [workerPlugin(), base64Plugin()],
  platformOverride: "browser",
  loader: {
    ".glb": "dataurl",
  },
});

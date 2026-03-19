import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mml-io/networked-dom-server": resolve(__dirname, "test/__mocks__/networked-dom-server.ts"),
      "@mml-io/mml-web": resolve(__dirname, "test/__mocks__/mml-web.ts"),
      "@mml-io/mml-web-threejs": resolve(__dirname, "test/__mocks__/mml-web-threejs.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    testTimeout: 30000,
    include: ["test/**/*.test.ts"],
    exclude: ["test/model-loading.test.ts", "test/collision-detection.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/navmesh-worker.ts", "src/cli.ts", "src/node-polyfills.ts"],
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
    },
    reporters: ["default"],
  },
});

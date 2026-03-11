import type { JestConfigWithTsJest } from "ts-jest";

const jestConfig: JestConfigWithTsJest = {
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  verbose: true,
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text-summary", "lcov"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.server.json",
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!@mml-io/.*)"],
  testEnvironment: "node",
  reporters: [
    "default",
    ["jest-junit", { outputDirectory: "./test-results", outputName: "3d-web-experience" }],
  ],
};

export default jestConfig;

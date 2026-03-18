import fs from "fs";
import path from "path";
import url from "url";

import { Command } from "commander";

import { parseWorldConfig, WorldConfig } from "./config";
import { init } from "./init";
import { serve } from "./serve";

function loadWorldConfig(configPath: string): WorldConfig {
  const resolvedConfigPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(`World config not found: ${resolvedConfigPath}`);
  }

  let rawConfig: unknown;
  try {
    const content = fs.readFileSync(resolvedConfigPath, "utf8");
    rawConfig = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse world config: ${(err as Error).message}`);
  }

  return parseWorldConfig(rawConfig);
}

const dirname = url.fileURLToPath(new URL(".", import.meta.url));
let packageVersion = "unknown";
try {
  packageVersion = JSON.parse(
    fs.readFileSync(path.join(dirname, "../package.json"), "utf8"),
  ).version;
} catch {
  // Package metadata unavailable — non-fatal
}

const program = new Command();

program
  .name("3d-web-experience")
  .description("CLI for running multi-user 3D web experiences with MML documents")
  .version(packageVersion);

program
  .command("init")
  .description("Generate a starter world.json and MML document")
  .argument("[directory]", "directory to initialize in", ".")
  .action((directory: string) => {
    try {
      init(path.resolve(directory));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("validate")
  .description("Validate a world config JSON file without starting the server")
  .argument("<world-config>", "path to the world config JSON file")
  .action((configPath: string) => {
    try {
      loadWorldConfig(configPath);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }

    console.log(`${path.resolve(configPath)} is valid`);
  });

program
  .command("serve")
  .description(
    "Start a 3D web experience server from a world config. " +
      "The server watches the config file for changes and live-reloads connected clients. " +
      'Use "3d-web-experience init" to generate a starter config.',
  )
  .argument("<world-config>", "path to the world config JSON file")
  .showHelpAfterError('Use "3d-web-experience init" to generate a starter config.')
  .option("-p, --port <number>", "port to listen on", "8080")
  .option("--host <address>", "host to listen on", "127.0.0.1")
  .option("--no-watch", "disable live-reloading when the world config file changes")
  .option("--mml-documents <path>", "serve MML documents from this directory")
  .option("--mml-ws-path <path>", "WebSocket URL path for MML documents", "/mml-documents/")
  .option("--assets <path>", "serve a directory as static assets")
  .option("--assets-url-path <path>", "URL path to serve assets on", "/assets/")
  .action(
    (
      configPath: string,
      options: {
        port: string;
        host: string;
        watch: boolean;
        mmlDocuments?: string;
        mmlWsPath: string;
        assets?: string;
        assetsUrlPath: string;
      },
    ) => {
      const resolvedConfigPath = path.resolve(configPath);
      let worldConfig: WorldConfig;
      try {
        worldConfig = loadWorldConfig(configPath);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }

      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 0 || port > 65535) {
        console.error(`Invalid port: ${options.port} (must be 0–65535)`);
        process.exit(1);
      }

      serve(worldConfig, {
        port,
        host: options.host,
        watch: options.watch,
        configPath: resolvedConfigPath,
        mmlDocuments: options.mmlDocuments,
        mmlWsPath: options.mmlWsPath,
        assets: options.assets,
        assetsUrlPath: options.assetsUrlPath,
      }).catch((err) => {
        console.error(`Server failed to start: ${(err as Error).message}`);
        process.exit(1);
      });
    },
  );

process.on("unhandledRejection", (err) => {
  console.error(`Unhandled error: ${(err as Error).message ?? err}`);
  process.exit(1);
});

program.parse();

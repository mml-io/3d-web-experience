import fs from "fs";
import path from "path";
import url from "url";

import {
  FROM_SERVER_BROADCAST_MESSAGE_TYPE,
  WorldConfigPayload,
} from "@mml-io/3d-web-experience-protocol";
import {
  Networked3dWebExperienceServer,
  Networked3dWebExperienceServerConfig,
} from "@mml-io/3d-web-experience-server";
import { watch, FSWatcher } from "chokidar";
import express from "express";

import { BasicUserAuthenticator } from "./BasicUserAuthenticator";
import { buildPageConfig, PageConfig, parseWorldConfig, WorldConfig } from "./config";
import { WORLD_CONFIG_UPDATE_BROADCAST_TYPE } from "./constants";
import { RemoteUserAuthenticator } from "./RemoteUserAuthenticator";

const dirname = url.fileURLToPath(new URL(".", import.meta.url));

const CONFIG_PLACEHOLDER = "CONFIG_PLACEHOLDER";

/**
 * Escape a JSON string for safe embedding in a `<script>` block.
 * Replaces all `<` with `\u003c` to prevent `</script>` and `<!--` sequences
 * from interfering with HTML parsing, and escapes U+2028/U+2029 which are
 * valid in JSON but act as line terminators in JavaScript string literals.
 */
export function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function normalizeUrlPath(urlPath: string): string {
  let normalized = urlPath;
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }
  if (!normalized.endsWith("/")) {
    normalized = normalized + "/";
  }
  return normalized;
}

export type ServeOptions = {
  port: number;
  host: string;
  watch: boolean;
  configPath: string;
  mmlDocuments?: string;
  mmlWsPath: string;
  assets?: string;
  assetsUrlPath: string;
};

export type ServeHandle = {
  close(): void;
};

export async function serve(worldConfig: WorldConfig, options: ServeOptions): Promise<ServeHandle> {
  const { port, host } = options;
  const configDir = path.dirname(options.configPath);

  // Auto-detect mml-documents directory next to the config file if not explicitly provided
  let mmlDocumentsDir = options.mmlDocuments;
  if (!mmlDocumentsDir) {
    const mmlDocsDir = path.join(configDir, "mml-documents");
    if (fs.existsSync(mmlDocsDir)) {
      mmlDocumentsDir = mmlDocsDir;
      console.log(`Auto-detected MML documents directory: ${mmlDocsDir}`);
    }
  }

  const authConfig = worldConfig.auth ?? {};
  const allowAnonymous = authConfig.allowAnonymous ?? false;

  const mmlWsPath = normalizeUrlPath(options.mmlWsPath);
  const assetsUrlPath = normalizeUrlPath(options.assetsUrlPath);

  // Reject "/" as a custom path — it would capture all requests.
  if (mmlWsPath === "/") {
    throw new Error(`--mml-ws-path cannot be "/" — it would capture all requests`);
  }
  if (assetsUrlPath === "/") {
    throw new Error(`--assets-url-path cannot be "/" — it would capture all requests`);
  }

  const reservedPrefixes = ["/network", "/api/", "/web-client/", "/avatars/", "/client-scripts/"];

  // Strip trailing slashes for prefix comparison so "/net/" correctly conflicts
  // with "/network" and vice versa. A path is a conflict when either is a prefix
  // of the other (ignoring trailing slashes).
  function stripTrailingSlash(p: string): string {
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  }
  function pathsConflict(a: string, b: string): boolean {
    const sa = stripTrailingSlash(a);
    const sb = stripTrailingSlash(b);
    return sa.startsWith(sb) || sb.startsWith(sa);
  }

  for (const reserved of reservedPrefixes) {
    // Check both directions: user path is prefix of reserved, or reserved is prefix of user path.
    if (pathsConflict(mmlWsPath, reserved)) {
      throw new Error(
        `--mml-ws-path "${options.mmlWsPath}" conflicts with reserved route "${reserved}"`,
      );
    }
    if (pathsConflict(assetsUrlPath, reserved)) {
      throw new Error(
        `--assets-url-path "${options.assetsUrlPath}" conflicts with reserved route "${reserved}"`,
      );
    }
  }

  // Check that mmlWsPath and assetsUrlPath don't conflict with each other.
  if (pathsConflict(mmlWsPath, assetsUrlPath)) {
    throw new Error(
      `--mml-ws-path "${options.mmlWsPath}" conflicts with --assets-url-path "${options.assetsUrlPath}"`,
    );
  }

  if (authConfig.webhookUrl && authConfig.serverUrl) {
    console.warn(
      "WARNING: Both auth.webhookUrl and auth.serverUrl are set. " +
        "auth.serverUrl takes precedence — auth.webhookUrl will be ignored.",
    );
  }

  const avatarFiles = [
    "avatar-1-bodyA-skin01.glb",
    "avatar-2-bodyB-skin03.glb",
    "avatar-3-bodyA-skin05.glb",
    "avatar-4-bodyB-skin07.glb",
  ];
  const defaultCharacterDescriptions = avatarFiles.map((f) => ({
    meshFileUrl: `/avatars/${f}`,
  }));

  // Set up authenticator based on config
  let userAuthenticator: BasicUserAuthenticator | RemoteUserAuthenticator;

  if (authConfig.serverUrl) {
    userAuthenticator = new RemoteUserAuthenticator({
      serverUrl: authConfig.serverUrl,
      defaultCharacterDescription: defaultCharacterDescriptions[0],
    });
  } else {
    userAuthenticator = new BasicUserAuthenticator({
      defaultCharacterDescriptions,
      allowAnonymous,
      webhookUrl: authConfig.webhookUrl,
      maxConnections: authConfig.maxConnections,
    });
  }

  const clientBuildDir = path.join(dirname, "client/");
  const indexHtmlPath = path.join(clientBuildDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `Client build not found at ${clientBuildDir}. Run "npm run build" in the 3d-web package first.`,
    );
  }
  let indexTemplate = fs.readFileSync(indexHtmlPath, "utf8");

  // Inject client scripts into the HTML template
  const clientScriptPaths: { servePath: string; localPath: string }[] = [];
  if (worldConfig.clientScripts && worldConfig.clientScripts.length > 0) {
    const scriptTags: string[] = [];
    for (const script of worldConfig.clientScripts) {
      if (script.startsWith("http://") || script.startsWith("https://")) {
        const escapedUrl = script
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        scriptTags.push(`<script src="${escapedUrl}"></script>`);
      } else {
        const localPath = path.resolve(configDir, script);
        const realConfigDir = fs.realpathSync(path.resolve(configDir));
        if (!fs.existsSync(localPath)) {
          throw new Error(`Client script not found: ${localPath}`);
        }
        const realLocalPath = fs.realpathSync(localPath);
        if (!realLocalPath.startsWith(realConfigDir + path.sep)) {
          throw new Error(`Client script path escapes config directory: ${script}`);
        }
        const fileName = path.basename(localPath);
        const encodedFileName = encodeURIComponent(fileName);
        const servePath = `/client-scripts/${clientScriptPaths.length}-${encodedFileName}`;
        clientScriptPaths.push({ servePath, localPath });
        scriptTags.push(`<script src="${servePath}"></script>`);
      }
    }
    if (scriptTags.length > 0) {
      const injection = scriptTags.join("\n");
      const marker = "</body>";
      if (!indexTemplate.includes(marker)) {
        throw new Error(
          "Client index.html is missing a </body> tag — cannot inject client scripts",
        );
      }
      indexTemplate = indexTemplate.replace(marker, `${injection}\n${marker}`);
    }
  }

  let currentPageConfig: PageConfig = buildPageConfig(worldConfig);

  function buildIndexContent(config: PageConfig): string {
    return indexTemplate.replace(CONFIG_PLACEHOLDER, () =>
      escapeJsonForScript(JSON.stringify(config)),
    );
  }

  const serverConfig: Networked3dWebExperienceServerConfig = {
    networkPath: "/network",
    userAuthenticator,
    enableChat: worldConfig.chat ?? true,
    worldConfig: buildWorldConfigPayload(worldConfig),
    webClientServing: {
      indexUrl: "/",
      indexContent: buildIndexContent(currentPageConfig),
      clientBuildDir,
      clientUrl: "/web-client/",
    },
  };

  if (mmlDocumentsDir) {
    const documentsDirectoryRoot = path.resolve(mmlDocumentsDir);
    if (!fs.existsSync(documentsDirectoryRoot)) {
      throw new Error(`MML documents directory not found: ${documentsDirectoryRoot}`);
    }
    serverConfig.mmlServing = {
      documentsWatchPath: "**/*.html",
      documentsDirectoryRoot,
      documentsUrl: mmlWsPath,
    };
  }

  if (options.assets) {
    const assetsDir = path.resolve(options.assets);
    if (!fs.existsSync(assetsDir)) {
      throw new Error(`Assets directory not found: ${assetsDir}`);
    }
    serverConfig.assetServing = {
      assetsDir,
      assetsUrl: assetsUrlPath,
    };
  }

  const app = express();
  if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
  }

  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  function buildWorldConfigPayload(config: WorldConfig): WorldConfigPayload {
    const payload: WorldConfigPayload = {};
    if (config.chat !== undefined) payload.enableChat = config.chat;
    if (config.allowOrbitalCamera !== undefined)
      payload.allowOrbitalCamera = config.allowOrbitalCamera;
    if (config.allowCustomDisplayName !== undefined)
      payload.allowCustomDisplayName = config.allowCustomDisplayName;
    if (config.enableTweakPane !== undefined) payload.enableTweakPane = config.enableTweakPane;
    if (config.postProcessingEnabled !== undefined)
      payload.postProcessingEnabled = config.postProcessingEnabled;
    if (config.mmlDocuments !== undefined) payload.mmlDocuments = config.mmlDocuments;
    if (config.environment !== undefined)
      payload.environmentConfiguration =
        config.environment as WorldConfigPayload["environmentConfiguration"];
    if (config.spawn !== undefined) payload.spawnConfiguration = config.spawn;
    if (config.avatars !== undefined)
      payload.avatarConfiguration = config.avatars as WorldConfigPayload["avatarConfiguration"];
    if (config.hud !== undefined) payload.hud = config.hud;
    return payload;
  }

  const avatarModelsDir = path.join(dirname, "../assets/models");
  for (const avatarFile of avatarFiles) {
    app.get(`/avatars/${avatarFile}`, (_req: express.Request, res: express.Response) => {
      res.sendFile(path.join(avatarModelsDir, avatarFile));
    });
  }

  // Serve local client scripts
  for (const { servePath, localPath } of clientScriptPaths) {
    app.get(servePath, (_req: express.Request, res: express.Response) => {
      res.type("application/javascript").sendFile(localPath);
    });
  }

  const server = new Networked3dWebExperienceServer(serverConfig);
  server.registerExpressRoutes(app);

  let configWatcher: FSWatcher | null = null;
  if (options.watch) {
    // Tracking variables for restart-required fields. These hold the values
    // from the initial config that the server was started with, so every
    // reload correctly detects drift from what is actually running.
    const lastAppliedClientScripts = JSON.stringify(worldConfig.clientScripts);
    const lastAppliedAuthServerUrl = worldConfig.auth?.serverUrl;
    const lastAppliedWebhookUrl = worldConfig.auth?.webhookUrl;
    const lastAppliedMaxConnections = worldConfig.auth?.maxConnections;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    configWatcher = watch(options.configPath).on("change", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        try {
          const content = fs.readFileSync(options.configPath, "utf8");
          const rawConfig: unknown = JSON.parse(content);
          const updatedWorldConfig = parseWorldConfig(rawConfig);

          // Fields that require a full server restart to take effect.
          const restartRequiredChecks: Array<{
            field: string;
            oldValue: unknown;
            newValue: unknown;
          }> = [
            {
              field: "clientScripts",
              oldValue: lastAppliedClientScripts,
              newValue: JSON.stringify(updatedWorldConfig.clientScripts),
            },
            {
              field: "auth.serverUrl",
              oldValue: lastAppliedAuthServerUrl,
              newValue: updatedWorldConfig.auth?.serverUrl,
            },
            {
              field: "auth.webhookUrl",
              oldValue: lastAppliedWebhookUrl,
              newValue: updatedWorldConfig.auth?.webhookUrl,
            },
            {
              field: "auth.maxConnections",
              oldValue: lastAppliedMaxConnections,
              newValue: updatedWorldConfig.auth?.maxConnections,
            },
          ];
          const changedRestartFields = restartRequiredChecks
            .filter((c) => c.oldValue !== c.newValue)
            .map((c) => c.field);
          if (changedRestartFields.length > 0) {
            console.warn(
              `WARNING: The following config fields changed but require a server restart ` +
                `to take effect: ${changedRestartFields.join(", ")}`,
            );
          }

          currentPageConfig = buildPageConfig(updatedWorldConfig);
          server.setIndexContent(buildIndexContent(currentPageConfig));
          server.setEnableChat(updatedWorldConfig.chat ?? true);
          const updatedPayload = buildWorldConfigPayload(updatedWorldConfig);
          serverConfig.worldConfig = updatedPayload;

          // Update auth settings on the authenticator so changes take
          // effect for new connections without a server restart.
          if ("setAllowAnonymous" in userAuthenticator) {
            const updatedAuth = updatedWorldConfig.auth ?? {};
            userAuthenticator.setAllowAnonymous(updatedAuth.allowAnonymous ?? false);
          }

          console.log("World config updated, broadcasting to connected clients");

          // Update the server's internal world config so new clients receive the
          // latest values on connect. Broadcast is handled separately below via
          // the WORLD_CONFIG_UPDATE_BROADCAST_TYPE channel that the client listens
          // on for live-reload updates.
          server.setWorldConfig(updatedPayload, { broadcast: false });

          server.userNetworkingServer?.broadcastMessage(
            FROM_SERVER_BROADCAST_MESSAGE_TYPE,
            JSON.stringify({
              broadcastType: WORLD_CONFIG_UPDATE_BROADCAST_TYPE,
              payload: updatedPayload,
            }),
          );
        } catch (err) {
          console.error(`Failed to reload world config: ${(err as Error).message}`);
        }
      }, 300);
    });
  }

  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const srv = app.listen(port, host, () => {
      console.log(`3D Web Experience server listening on http://${host}:${port}`);
      if (authConfig.serverUrl) {
        console.log(`Auth: remote server (${authConfig.serverUrl})`);
      } else if (authConfig.webhookUrl) {
        console.log(`Auth: webhook (${authConfig.webhookUrl})`);
      }
      if (!authConfig.serverUrl && allowAnonymous) {
        console.log("Auth: anonymous access enabled");
      }
      if (authConfig.maxConnections) {
        console.log(`Auth: max connections = ${authConfig.maxConnections}`);
      }
      if (options.watch) {
        console.log(`Watching ${options.configPath} for changes`);
      }
      if (worldConfig.mmlDocuments) {
        const docNames = Object.keys(worldConfig.mmlDocuments);
        if (docNames.length > 0) {
          console.log(`MML documents: ${docNames.join(", ")}`);
        }
      }
      resolve(srv);
    });

    srv.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${port} is already in use. Use --port to specify a different port, ` +
            `e.g. 3d-web-experience serve ${path.basename(options.configPath)} --port ${port + 1}`,
        );
      }
      reject(err);
    });
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    configWatcher?.close();
    userAuthenticator.dispose();
    server.dispose();
    httpServer.close();
    httpServer.closeAllConnections();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { close: shutdown };
}

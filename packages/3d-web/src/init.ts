import fs from "fs";
import path from "path";

import { defaultWorldConfig, sampleMMLDocument } from "./defaults";

export function init(directory: string): void {
  const worldConfigPath = path.join(directory, "world.json");
  const mmlDocumentsDir = path.join(directory, "mml-documents");
  const sampleDocPath = path.join(mmlDocumentsDir, "hello-world.html");

  if (fs.existsSync(worldConfigPath)) {
    throw new Error(`world.json already exists in ${directory}`);
  }

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(worldConfigPath, JSON.stringify(defaultWorldConfig, null, 2) + "\n");
  console.log(`Created ${worldConfigPath}`);

  if (!fs.existsSync(mmlDocumentsDir)) {
    fs.mkdirSync(mmlDocumentsDir, { recursive: true });
  }

  if (fs.existsSync(sampleDocPath)) {
    console.log(`Skipping ${sampleDocPath} (already exists)`);
  } else {
    fs.writeFileSync(sampleDocPath, sampleMMLDocument);
    console.log(`Created ${sampleDocPath}`);
  }

  console.log();
  console.log("To start the server, run:");
  const relativeWorldConfig = path.relative(process.cwd(), worldConfigPath) || "world.json";
  const isNpx = process.env.npm_execpath?.includes("npx") || process.argv[1]?.includes(".npx");
  const bin = isNpx ? "npx 3d-web-experience" : "3d-web-experience";
  console.log(`  ${bin} serve ${relativeWorldConfig}`);
}

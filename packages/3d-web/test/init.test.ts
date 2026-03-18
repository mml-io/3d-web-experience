import fs from "fs";
import os from "os";
import path from "path";

import { jest } from "@jest/globals";

import { parseWorldConfig } from "../src/config";
import { init } from "../src/init";

describe("init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "3d-web-init-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates world.json with default config", () => {
    const dir = path.join(tmpDir, "project");
    init(dir);
    const worldJsonPath = path.join(dir, "world.json");
    expect(fs.existsSync(worldJsonPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(worldJsonPath, "utf8"));
    expect(content.chat).toBe(true);
    expect(content.auth?.allowAnonymous).toBe(true);
  });

  it("creates mml-documents/hello-world.html", () => {
    const dir = path.join(tmpDir, "project");
    init(dir);
    const htmlPath = path.join(dir, "mml-documents", "hello-world.html");
    expect(fs.existsSync(htmlPath)).toBe(true);
    const content = fs.readFileSync(htmlPath, "utf8");
    expect(content).toContain("m-cube");
    expect(content).toContain("Hello World");
  });

  it("created world.json is valid per parseWorldConfig", () => {
    const dir = path.join(tmpDir, "project");
    init(dir);
    const worldJsonPath = path.join(dir, "world.json");
    const content = JSON.parse(fs.readFileSync(worldJsonPath, "utf8"));
    expect(() => parseWorldConfig(content)).not.toThrow();
  });

  it("throws if world.json already exists", () => {
    const dir = path.join(tmpDir, "project");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "world.json"), "{}");

    expect(() => init(dir)).toThrow("world.json already exists");
  });

  it("creates parent directories recursively", () => {
    const dir = path.join(tmpDir, "a", "b", "c");
    init(dir);
    expect(fs.existsSync(path.join(dir, "world.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "mml-documents", "hello-world.html"))).toBe(true);
  });
});

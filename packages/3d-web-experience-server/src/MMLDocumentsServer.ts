import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { EditableNetworkedDOM, LocalObservableDOMFactory } from "@mml-io/networked-dom-server";
import { watch, FSWatcher } from "chokidar";
import micromatch from "micromatch";
import WebSocket from "ws";

const getMmlDocumentContent = (documentPath: string) => {
  return fs.readFileSync(documentPath, { encoding: "utf8", flag: "r" });
};

export class MMLDocumentsServer {
  private documents = new Map<
    string,
    {
      documentPath: string;
      document: EditableNetworkedDOM;
    }
  >();
  private watcher: FSWatcher;
  private watchPattern: string;

  constructor(
    private directory: string,
    watchPattern: string,
  ) {
    this.watchPattern = watchPattern;
    this.watch();
  }

  public dispose() {
    for (const { document } of this.documents.values()) {
      document.dispose();
    }
    this.documents.clear();
    this.watcher.close();
  }

  public handle(filename: string, ws: WebSocket) {
    const document = this.documents.get(filename)?.document;
    if (!document) {
      ws.close();
      return;
    }

    document.addWebSocket(ws as any);
    ws.on("close", () => {
      document.removeWebSocket(ws as any);
    });
  }

  private watch() {
    this.watcher = watch(this.directory, {
      ignoreInitial: false,
      ignored: (checkPath, stats) => {
        if (!stats || !stats.isFile()) {
          return false;
        }
        return !micromatch.isMatch(checkPath, this.watchPattern);
      },
      persistent: true,
    });
    this.watcher
      .on("add", (fullPath, stats) => {
        if (!stats || !stats.isFile()) {
          return;
        }
        const relativePath = path.relative(this.directory, fullPath);
        console.log(`MML Document '${relativePath}' has been added`);
        const contents = getMmlDocumentContent(fullPath);
        const document = new EditableNetworkedDOM(
          url.pathToFileURL(fullPath).toString(),
          LocalObservableDOMFactory,
        );
        document.load(contents);

        const currentData = {
          documentPath: fullPath,
          document,
        };
        this.documents.set(relativePath, currentData);
      })
      .on("change", (fullPath) => {
        const relativePath = path.relative(this.directory, fullPath);
        console.log(`MML Document '${relativePath}' has been changed`);
        const contents = getMmlDocumentContent(fullPath);
        const documentState = this.documents.get(relativePath);
        if (!documentState) {
          console.error(`MML Document '${relativePath}' not found`);
          return;
        }
        documentState.document.load(contents);
      })
      .on("unlink", (fullPath) => {
        const relativePath = path.relative(this.directory, fullPath);
        console.log(`MML Document '${relativePath}' has been removed`);
        const documentState = this.documents.get(relativePath);
        if (!documentState) {
          console.error(`MML Document '${relativePath}' not found`);
          return;
        }
        documentState.document.dispose();
        this.documents.delete(relativePath);
      })
      .on("error", (error) => {
        console.error("Error whilst watching directory", error);
      });
  }
}

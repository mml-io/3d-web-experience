import { MMLDocumentConfiguration } from "@mml-io/3d-web-client-core";
import {
  LoadingProgressManager,
  MMLNetworkSource,
  NetworkedDOMWebsocketStatus,
} from "@mml-io/mml-web";

import { ThreeJSMMLCompositionScene } from "./ThreeJSMMLCompositionScene";

type MMLDocumentState = {
  docRef: unknown;
  loadingProgressManager: LoadingProgressManager | null;
  config: MMLDocumentConfiguration;
  source: MMLNetworkSource;
  dispose: () => void;
};

export class ThreeJSMMLManager {
  private mmlDocumentStates: { [key: string]: MMLDocumentState } = {};
  private authToken: string | null = null;

  constructor(
    private mmlCompositionScene: ThreeJSMMLCompositionScene,
    private mmlTargetWindow: Window,
    private mmlTargetElement: HTMLElement,
    private loadingProgressManager: LoadingProgressManager | null,
  ) {}

  setMMLConfiguration(
    mmlDocuments: { [key: string]: MMLDocumentConfiguration },
    authToken: string | null,
  ): void {
    this.authToken = authToken;
    const newMMLDocuments: { [key: string]: MMLDocumentState } = {};
    for (const [key, mmlDocConfig] of Object.entries(mmlDocuments)) {
      let existing: MMLDocumentState | undefined = this.mmlDocumentStates[key];
      if (
        existing &&
        (existing.config.url !== mmlDocConfig.url ||
          existing.config.passAuthToken !== mmlDocConfig.passAuthToken)
      ) {
        // URL or auth token changed - dispose of existing and create new
        existing.dispose();
        existing = undefined;
      }
      if (!existing) {
        newMMLDocuments[key] = this.createMMLDocument(mmlDocConfig);
      } else {
        delete this.mmlDocumentStates[key];
        this.updateMMLDocumentAttributes(existing.source, mmlDocConfig);
        newMMLDocuments[key] = existing;
      }
    }
    for (const element of Object.values(this.mmlDocumentStates)) {
      element.dispose();
    }
    this.mmlDocumentStates = newMMLDocuments;
  }

  onChatMessage(message: string): void {
    if (this.mmlCompositionScene) {
      this.mmlCompositionScene.onChatMessage(message);
    }
  }

  dispose(): void {
    // Dispose MML documents
    for (const mmlDocumentState of Object.values(this.mmlDocumentStates)) {
      mmlDocumentState.dispose();
    }
    this.mmlDocumentStates = {};
  }

  private createMMLDocument(mmlDocConfig: MMLDocumentConfiguration): MMLDocumentState {
    const mmlScene = this.mmlCompositionScene.mmlScene;
    const docRef = {};
    const mmlNetworkSource = MMLNetworkSource.create({
      url: MMLNetworkSource.resolveRelativeUrl(window.location.host, mmlDocConfig.url),
      connectionToken: mmlDocConfig.passAuthToken ? this.authToken : null,
      mmlScene,
      statusUpdated: (status: NetworkedDOMWebsocketStatus) => {
        // no-op
      },
      windowTarget: this.mmlTargetWindow,
      targetForWrappers: this.mmlTargetElement,
    });

    this.updateMMLDocumentAttributes(mmlNetworkSource, mmlDocConfig);
    return {
      docRef,
      loadingProgressManager: this.loadingProgressManager,
      config: mmlDocConfig,
      source: mmlNetworkSource,
      dispose: () => {
        mmlNetworkSource.dispose();
      },
    };
  }

  private updateMMLDocumentAttributes(
    mmlNetworkSource: MMLNetworkSource,
    mmlDocument: MMLDocumentConfiguration,
  ) {
    const remoteDocument = mmlNetworkSource.remoteDocumentWrapper.remoteDocument;
    if (mmlDocument.position) {
      remoteDocument.setAttribute("x", mmlDocument.position.x.toString());
      remoteDocument.setAttribute("y", mmlDocument.position.y.toString());
      remoteDocument.setAttribute("z", mmlDocument.position.z.toString());
    } else {
      remoteDocument.setAttribute("x", "0");
      remoteDocument.setAttribute("y", "0");
      remoteDocument.setAttribute("z", "0");
    }
    if (mmlDocument.rotation) {
      remoteDocument.setAttribute("rx", mmlDocument.rotation.x.toString());
      remoteDocument.setAttribute("ry", mmlDocument.rotation.y.toString());
      remoteDocument.setAttribute("rz", mmlDocument.rotation.z.toString());
    } else {
      remoteDocument.setAttribute("rx", "0");
      remoteDocument.setAttribute("ry", "0");
      remoteDocument.setAttribute("rz", "0");
    }
    if (mmlDocument.scale?.x !== undefined) {
      remoteDocument.setAttribute("sx", mmlDocument.scale.x.toString());
    } else {
      remoteDocument.setAttribute("sx", "1");
    }
    if (mmlDocument.scale?.y !== undefined) {
      remoteDocument.setAttribute("sy", mmlDocument.scale.y.toString());
    } else {
      remoteDocument.setAttribute("sy", "1");
    }
    if (mmlDocument.scale?.z !== undefined) {
      remoteDocument.setAttribute("sz", mmlDocument.scale.z.toString());
    } else {
      remoteDocument.setAttribute("sz", "1");
    }
    return mmlNetworkSource;
  }
}

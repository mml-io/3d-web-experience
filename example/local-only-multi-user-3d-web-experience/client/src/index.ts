import { SpawnConfigurationState } from "@mml-io/3d-web-client-core";
import { IframeWrapper, MMLScene, registerCustomElementsToWindow } from "@mml-io/mml-web";
import {
  EditableNetworkedDOM,
  IframeObservableDOMFactory,
  MMLWebRunnerClient,
} from "@mml-io/mml-web-runner";
import {
  StandaloneThreeJSAdapter,
  StandaloneThreeJSAdapterControlsType,
} from "@mml-io/mml-web-threejs-standalone";

import exampleMMLDocumentHTML from "./example-mml.html";
import { LocalAvatarClient } from "./LocalAvatarClient";
import { LocalAvatarServer } from "./LocalAvatarServer";

type ClientInfo = {
  id: number;
  client: LocalAvatarClient;
  container: HTMLDivElement;
};

window.addEventListener("DOMContentLoaded", async () => {
  // Create an iframe that the clients can use to synchronize their view of the MML document to
  const { iframeWindow, iframeBody } = await IframeWrapper.create();
  // Register the MML (custom) elements to the iframe so that elements (e.g. m-cube) run the HTMLCustomElement logic when appended
  registerCustomElementsToWindow(iframeWindow);

  // Create a NetworkedDOM/MML document that the clients will connect to and interact with
  const networkedDOMDocument = new EditableNetworkedDOM(
    "http://example.com/index.html",
    IframeObservableDOMFactory,
    true,
  );

  // Create a "local" server that the avatar clients can connect to to see each other
  const localAvatarServer = new LocalAvatarServer();

  // Track all clients
  const clients: ClientInfo[] = [];
  let nextConnectionId = 1;

  // Create main layout container
  const mainContainer = document.createElement("div");
  mainContainer.style.position = "absolute";
  mainContainer.style.top = "0";
  mainContainer.style.left = "0";
  mainContainer.style.width = "100%";
  mainContainer.style.height = "100%";
  document.body.appendChild(mainContainer);

  // Create add client button in top right
  const addClientButton = document.createElement("button");
  addClientButton.textContent = "+";
  addClientButton.style.position = "absolute";
  addClientButton.style.top = "10px";
  addClientButton.style.right = "10px";
  addClientButton.style.zIndex = "1000";
  addClientButton.style.width = "40px";
  addClientButton.style.height = "40px";
  addClientButton.style.borderRadius = "50%";
  addClientButton.style.border = "none";
  addClientButton.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  addClientButton.style.color = "white";
  addClientButton.style.fontSize = "24px";
  addClientButton.style.cursor = "pointer";
  addClientButton.style.display = "flex";
  addClientButton.style.alignItems = "center";
  addClientButton.style.justifyContent = "center";
  addClientButton.style.fontFamily = "Arial, sans-serif";
  addClientButton.addEventListener("mouseenter", () => {
    addClientButton.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
  });
  addClientButton.addEventListener("mouseleave", () => {
    addClientButton.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  });
  mainContainer.appendChild(addClientButton);

  // Create clients container with grid layout
  const clientsContainer = document.createElement("div");
  clientsContainer.style.position = "absolute";
  clientsContainer.style.top = "0";
  clientsContainer.style.left = "0";
  clientsContainer.style.width = "100%";
  clientsContainer.style.height = "50%";
  clientsContainer.style.display = "grid";
  clientsContainer.style.overflow = "hidden";
  mainContainer.appendChild(clientsContainer);

  function updateGridLayout() {
    const count = clients.length;
    if (count === 0) return;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    clientsContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    clientsContainer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  }

  // Create textarea and MML scene in fixed positions
  const textAreaContainer = document.createElement("div");
  textAreaContainer.style.position = "absolute";
  textAreaContainer.style.top = "50%";
  textAreaContainer.style.left = "0";
  textAreaContainer.style.width = "50%";
  textAreaContainer.style.height = "50%";
  textAreaContainer.style.border = "2px solid #333";
  textAreaContainer.style.boxSizing = "border-box";
  mainContainer.appendChild(textAreaContainer);

  const textArea = document.createElement("textarea");
  textArea.style.width = "100%";
  textArea.style.height = "100%";
  textArea.style.boxSizing = "border-box";
  textArea.value = exampleMMLDocumentHTML;
  textArea.addEventListener("input", () => {
    networkedDOMDocument.load(textArea.value);
  });
  textAreaContainer.appendChild(textArea);

  const mmlSceneContainer = document.createElement("div");
  mmlSceneContainer.style.position = "absolute";
  mmlSceneContainer.style.top = "50%";
  mmlSceneContainer.style.left = "50%";
  mmlSceneContainer.style.width = "50%";
  mmlSceneContainer.style.height = "50%";
  mmlSceneContainer.style.border = "2px solid #333";
  mmlSceneContainer.style.boxSizing = "border-box";
  mainContainer.appendChild(mmlSceneContainer);

  const sceneElement = document.createElement("div");
  sceneElement.style.width = "100%";
  sceneElement.style.height = "100%";
  const mmlScene = new MMLScene(sceneElement);
  mmlSceneContainer.append(mmlScene.element);

  StandaloneThreeJSAdapter.create(sceneElement, {
    controlsType: StandaloneThreeJSAdapterControlsType.DragFly,
  }).then((graphicsAdapter) => {
    mmlScene.init(graphicsAdapter);

    // Create a client that will synchronize the MMLScene with the local NetworkedDOM
    const flyCameraClient = new MMLWebRunnerClient(iframeWindow, iframeBody, mmlScene);
    flyCameraClient.connect(networkedDOMDocument);
  });

  // Load the source for the MML document into the NetworkedDOM
  networkedDOMDocument.load(textArea.value);

  function createDefaultSpawnConfig(connectionId: number): SpawnConfigurationState {
    const offsetX = (connectionId % 4) * 1.0 - 1.5;
    const offsetZ = Math.floor(connectionId / 4) * 1.0;
    return {
      spawnPosition: {
        x: offsetX,
        y: 0.5,
        z: 5 + offsetZ,
      },
      spawnPositionVariance: {
        x: 0,
        y: 0,
        z: 0,
      },
      respawnTrigger: {
        minX: Number.NEGATIVE_INFINITY,
        maxX: Number.POSITIVE_INFINITY,
        minY: -100,
        maxY: Number.POSITIVE_INFINITY,
        minZ: Number.NEGATIVE_INFINITY,
        maxZ: Number.POSITIVE_INFINITY,
      },
      spawnYRotation: 180,
      enableRespawnButton: connectionId === 1,
    };
  }

  async function createClient(connectionId: number): Promise<ClientInfo> {
    const container = document.createElement("div");
    container.style.position = "relative";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.border = "2px solid #333";
    container.style.boxSizing = "border-box";
    container.style.backgroundColor = "#1a1a1a";
    container.style.overflow = "hidden";
    container.style.minHeight = "0";

    const closeButton = document.createElement("button");
    closeButton.textContent = "×";
    closeButton.style.position = "absolute";
    closeButton.style.top = "5px";
    closeButton.style.left = "5px";
    closeButton.style.zIndex = "10";
    closeButton.style.width = "30px";
    closeButton.style.height = "30px";
    closeButton.style.borderRadius = "50%";
    closeButton.style.border = "none";
    closeButton.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    closeButton.style.color = "white";
    closeButton.style.fontSize = "20px";
    closeButton.style.cursor = "pointer";
    closeButton.style.display = "flex";
    closeButton.style.alignItems = "center";
    closeButton.style.justifyContent = "center";
    closeButton.style.fontFamily = "Arial, sans-serif";
    closeButton.style.lineHeight = "1";
    closeButton.addEventListener("mouseenter", () => {
      closeButton.style.backgroundColor = "rgba(200, 0, 0, 0.9)";
    });
    closeButton.addEventListener("mouseleave", () => {
      closeButton.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    });
    closeButton.addEventListener("click", () => {
      removeClient(connectionId);
    });
    container.appendChild(closeButton);

    const spawnConfig = createDefaultSpawnConfig(connectionId);
    const client = new LocalAvatarClient(
      localAvatarServer,
      connectionId,
      spawnConfig,
      iframeWindow,
      iframeBody,
    );
    await client.addDocument(networkedDOMDocument, iframeWindow, iframeBody);
    container.appendChild(client.element);
    client.update();

    return { id: connectionId, client, container };
  }

  async function addClient() {
    const connectionId = nextConnectionId++;
    const clientInfo = await createClient(connectionId);
    clients.push(clientInfo);
    clientsContainer.appendChild(clientInfo.container);
    updateGridLayout();
  }

  function removeClient(connectionId: number) {
    const index = clients.findIndex((c) => c.id === connectionId);
    if (index === -1) return;

    const clientInfo = clients[index];
    clients.splice(index, 1);
    clientInfo.client.dispose();
    clientInfo.container.remove();
    updateGridLayout();
  }

  addClientButton.addEventListener("click", addClient);

  // Create initial two clients
  await addClient();
  await addClient();
});

import { WorldConfig } from "./config";

export const defaultWorldConfig: WorldConfig = {
  chat: true,
  auth: {
    allowAnonymous: true,
  },
  mmlDocuments: {
    "hello-world.html": {
      // ws:/// (triple-slash) URLs are protocol-relative — the client resolves
      // them against the current page's protocol (ws: or wss:) and host.
      url: "ws:///mml-documents/hello-world.html",
      position: { x: 0, y: 0, z: 10 },
    },
  },
};

export const sampleMMLDocument = `<m-cube y="1.5" color="red" id="my-cube"></m-cube>

<m-label y="3.5" ry="180" width="3" font-size="50" alignment="center" content="Hello World"></m-label>

<script>
  const cube = document.getElementById("my-cube");
  cube.addEventListener("click", () => {
    const colors = ["red", "green", "blue", "yellow", "purple", "orange"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    cube.setAttribute("color", randomColor);
  });
</script>
`;

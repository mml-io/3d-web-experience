/**
 * Standalone HTML page for real-time navmesh debug visualization.
 * Served by the bridge at GET /navmesh-debug when --debug is enabled.
 * Connects to /navmesh-stream (SSE) for live updates.
 */
export function getNavMeshDebugPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NavMesh Debug</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0e17; overflow: hidden; font-family: 'Courier New', monospace; }
  canvas { display: block; }

  #info {
    position: absolute;
    top: 12px;
    left: 12px;
    background: rgba(10, 14, 23, 0.9);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 14px 18px;
    color: #e0e0e0;
    font-size: 12px;
    line-height: 1.7;
    min-width: 220px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10;
  }
  #info h2 {
    font-size: 14px;
    color: #00d4aa;
    margin-bottom: 8px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  #info .row { display: flex; justify-content: space-between; gap: 16px; }
  #info .label { color: #6b7280; }
  #info .value { color: #e0e0e0; text-align: right; }
  #info .sep { border-top: 1px solid rgba(255,255,255,0.06); margin: 6px 0; }

  #legend {
    position: absolute;
    bottom: 12px;
    left: 12px;
    background: rgba(10, 14, 23, 0.9);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 12px 16px;
    color: #e0e0e0;
    font-size: 11px;
    line-height: 1.8;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10;
  }
  #legend .item { display: flex; align-items: center; gap: 8px; }
  #legend .swatch {
    width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0;
  }

  #status {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(10, 14, 23, 0.9);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 11px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10;
  }
  .status-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
  }
  .status-ok { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
  .status-err { background: #ef4444; box-shadow: 0 0 6px #ef4444; }
  .status-wait { background: #eab308; box-shadow: 0 0 6px #eab308; }
</style>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
</head>
<body>

<div id="info">
  <h2>NavMesh Debug</h2>
  <div class="row"><span class="label">Triangles</span><span class="value" id="tri-count">-</span></div>
  <div class="row"><span class="label">Jump Links</span><span class="value" id="link-count">-</span></div>
  <div class="row"><span class="label">Generation</span><span class="value" id="generation">-</span></div>
  <div class="sep"></div>
  <div class="row"><span class="label">Agent Pos</span><span class="value" id="agent-pos">-</span></div>
  <div class="row"><span class="label">Moving</span><span class="value" id="agent-moving">-</span></div>
  <div class="row"><span class="label">Path Pts</span><span class="value" id="path-count">-</span></div>
  <div class="sep"></div>
  <div class="row"><span class="label">Region Center</span><span class="value" id="region-center">-</span></div>
  <div class="row"><span class="label">Region Size</span><span class="value" id="region-size">-</span></div>
  <div class="sep"></div>
  <div class="row"><span class="label">Spots</span><span class="value" id="spots-count">-</span></div>
  <div class="row"><span class="label">Surfaces</span><span class="value" id="surface-count">0</span></div>
  <div class="sep"></div>
  <div class="row"><span class="label">Players</span><span class="value" id="player-count">0</span></div>
  <div class="row"><span class="label">Following</span><span class="value" id="follow-target">Agent</span></div>
</div>

<div id="legend">
  <div class="item"><div class="swatch" style="background:#00d4aa;opacity:0.5"></div>NavMesh polygons</div>
  <div class="item"><div class="swatch" style="background:#ff9f43"></div>Jump links</div>
  <div class="item"><div class="swatch" style="background:#22c55e"></div>Agent position</div>
  <div class="item"><div class="swatch" style="background:#3b82f6"></div>Current path</div>
  <div class="item"><div class="swatch" style="background:#06b6d4"></div>Other players</div>
  <div class="item"><div class="swatch" style="background:#a855f7;opacity:0.5"></div>Placement spots</div>
  <div class="item"><div class="swatch" style="background:#06b6d4;opacity:0.5"></div>Surface spots</div>
  <div class="item"><div class="swatch" style="background:rgba(255,255,255,0.15)"></div>Region boundary</div>
</div>

<div id="status">
  <span class="status-dot status-wait" id="status-dot"></span>
  <span id="status-text" style="color:#e0e0e0">Connecting...</span>
</div>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BRIDGE_URL = window.location.origin;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e17);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 40, 40);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxPolarAngle = Math.PI * 0.85;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 40, 20);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(200, 40, 0x222233, 0x181825);
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

const originGeo = new THREE.RingGeometry(0.3, 0.5, 32);
const originMat = new THREE.MeshBasicMaterial({ color: 0x444444, side: THREE.DoubleSide });
const originRing = new THREE.Mesh(originGeo, originMat);
originRing.rotation.x = -Math.PI / 2;
originRing.position.y = 0.02;
scene.add(originRing);

let navmeshMesh = null;
let navmeshWireframe = null;
let jumpLinkLines = null;
let agentMarker = null;
let agentRing = null;
let pathLine = null;
let pathCompletedLine = null;
let regionBox = null;
let placementSpotMeshes = null;
let surfaceSpotMeshes = null;

const agentGeo = new THREE.SphereGeometry(0.4, 16, 12);
const agentMat = new THREE.MeshPhongMaterial({ color: 0x22c55e, emissive: 0x115522 });
agentMarker = new THREE.Mesh(agentGeo, agentMat);
agentMarker.visible = false;
scene.add(agentMarker);

const ringGeo = new THREE.RingGeometry(0.5, 0.7, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
agentRing = new THREE.Mesh(ringGeo, ringMat);
agentRing.rotation.x = -Math.PI / 2;
agentRing.visible = false;
scene.add(agentRing);

const userMarkers = new Map();

function createTextSprite(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  ctx.font = 'bold 28px Courier New';
  ctx.fillStyle = '#06b6d4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3, 0.75, 1);
  return sprite;
}

function addUserMarker(id, username, position) {
  const geo = new THREE.SphereGeometry(0.35, 16, 12);
  const mat = new THREE.MeshPhongMaterial({ color: 0x06b6d4, emissive: 0x033d4a });
  const marker = new THREE.Mesh(geo, mat);
  marker.position.set(position.x, position.y + 0.35, position.z);
  marker.userData = { type: 'user', userId: id };
  scene.add(marker);

  const rGeo = new THREE.RingGeometry(0.4, 0.55, 32);
  const rMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  const ring = new THREE.Mesh(rGeo, rMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(position.x, position.y + 0.03, position.z);
  scene.add(ring);

  const label = createTextSprite(username || 'Player ' + id);
  label.position.set(position.x, position.y + 1.4, position.z);
  scene.add(label);

  userMarkers.set(id, { marker, ring, label, ringMat: rMat });
}

function removeUserMarker(id) {
  const entry = userMarkers.get(id);
  if (!entry) return;
  scene.remove(entry.marker);
  entry.marker.geometry.dispose();
  entry.marker.material.dispose();
  scene.remove(entry.ring);
  entry.ring.geometry.dispose();
  entry.ringMat.dispose();
  scene.remove(entry.label);
  entry.label.material.map.dispose();
  entry.label.material.dispose();
  userMarkers.delete(id);
}

function updateUserMarker(id, username, position) {
  const entry = userMarkers.get(id);
  if (!entry) return;
  entry.marker.position.set(position.x, position.y + 0.35, position.z);
  entry.ring.position.set(position.x, position.y + 0.03, position.z);
  entry.label.position.set(position.x, position.y + 1.4, position.z);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let lastGeneration = -1;
let followTarget = 'agent';
let initialCameraSet = false;

const triCountEl = document.getElementById('tri-count');
const linkCountEl = document.getElementById('link-count');
const generationEl = document.getElementById('generation');
const agentPosEl = document.getElementById('agent-pos');
const agentMovingEl = document.getElementById('agent-moving');
const pathCountEl = document.getElementById('path-count');
const regionCenterEl = document.getElementById('region-center');
const regionSizeEl = document.getElementById('region-size');
const spotsCountEl = document.getElementById('spots-count');
const surfaceCountEl = document.getElementById('surface-count');
const playerCountEl = document.getElementById('player-count');
const followTargetEl = document.getElementById('follow-target');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

function fmt(v) { return v.toFixed(1); }

function clearMesh(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  });
}

function buildNavMesh(positions, indices) {
  clearMesh(navmeshMesh);
  clearMesh(navmeshWireframe);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    color: 0x00d4aa,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  navmeshMesh = new THREE.Mesh(geo, mat);
  navmeshMesh.renderOrder = 1;
  scene.add(navmeshMesh);

  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x00d4aa,
    wireframe: true,
    transparent: true,
    opacity: 0.4,
  });
  navmeshWireframe = new THREE.Mesh(geo.clone(), wireMat);
  navmeshWireframe.position.y += 0.01;
  navmeshWireframe.renderOrder = 2;
  scene.add(navmeshWireframe);
}

function buildJumpLinks(links) {
  clearMesh(jumpLinkLines);
  if (!links || links.length === 0) return;

  const points = [];
  const arrowPoints = [];

  for (const link of links) {
    const s = link.start;
    const e = link.end;

    points.push(s.x, s.y + 0.05, s.z);
    points.push(e.x, e.y + 0.05, e.z);

    const mx = s.x + (e.x - s.x) * 0.8;
    const my = s.y + (e.y - s.y) * 0.8 + 0.05;
    const mz = s.z + (e.z - s.z) * 0.8;
    const dx = e.x - s.x;
    const dz = e.z - s.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.1) {
      const nx = -dz / len * 0.3;
      const nz = dx / len * 0.3;
      arrowPoints.push(mx + nx, my, mz + nz);
      arrowPoints.push(e.x, e.y + 0.05, e.z);
      arrowPoints.push(mx - nx, my, mz - nz);
      arrowPoints.push(e.x, e.y + 0.05, e.z);
    }
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.8 });
  jumpLinkLines = new THREE.LineSegments(lineGeo, lineMat);
  jumpLinkLines.renderOrder = 3;
  scene.add(jumpLinkLines);

  if (arrowPoints.length > 0) {
    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrowPoints, 3));
    const arrowObj = new THREE.LineSegments(arrowGeo, lineMat.clone());
    arrowObj.renderOrder = 3;
    jumpLinkLines.add(arrowObj);
  }
}

function buildPath(path, waypointIndex) {
  clearMesh(pathLine);
  clearMesh(pathCompletedLine);
  if (!path || path.length < 2) return;

  if (waypointIndex > 0) {
    const completedPts = [];
    for (let i = 0; i <= Math.min(waypointIndex, path.length - 1); i++) {
      completedPts.push(new THREE.Vector3(path[i].x, path[i].y + 0.1, path[i].z));
    }
    if (completedPts.length >= 2) {
      const cGeo = new THREE.BufferGeometry().setFromPoints(completedPts);
      const cMat = new THREE.LineBasicMaterial({ color: 0x1e3a5f, linewidth: 2 });
      pathCompletedLine = new THREE.Line(cGeo, cMat);
      pathCompletedLine.renderOrder = 4;
      scene.add(pathCompletedLine);
    }
  }

  const remainPts = [];
  for (let i = Math.max(0, waypointIndex); i < path.length; i++) {
    remainPts.push(new THREE.Vector3(path[i].x, path[i].y + 0.1, path[i].z));
  }
  if (remainPts.length >= 2) {
    const rGeo = new THREE.BufferGeometry().setFromPoints(remainPts);
    const rMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 });
    pathLine = new THREE.Line(rGeo, rMat);
    pathLine.renderOrder = 4;
    scene.add(pathLine);
  }

  const dotGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  for (let i = waypointIndex; i < path.length; i++) {
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(path[i].x, path[i].y + 0.1, path[i].z);
    if (pathLine) pathLine.add(dot);
  }
}

function buildRegionBox(center, halfSize) {
  clearMesh(regionBox);
  if (!center) return;

  const geo = new THREE.BoxGeometry(halfSize * 2, 30, halfSize * 2);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 });
  regionBox = new THREE.LineSegments(edges, mat);
  regionBox.position.set(center.x, 15, center.z);
  regionBox.renderOrder = 0;
  scene.add(regionBox);
}

function clearGroup(group) {
  if (!group) return;
  scene.remove(group);
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
}

function buildPlacementSpots(spots) {
  clearGroup(placementSpotMeshes);
  if (!spots || spots.length === 0) return;

  placementSpotMeshes = new THREE.Group();
  placementSpotMeshes.renderOrder = 5;
  const purple = 0xa855f7;

  for (const spot of spots) {
    const w = spot.dimensions.width;
    const d = spot.dimensions.depth;
    const h = spot.dimensions.height;
    const sx = spot.position.x;
    const sy = spot.surfaceY;
    const sz = spot.position.z;

    const planeGeo = new THREE.PlaneGeometry(w, d);
    const planeMat = new THREE.MeshBasicMaterial({
      color: purple, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(sx, sy + 0.04, sz);
    placementSpotMeshes.add(plane);

    const boxGeo = new THREE.BoxGeometry(w, Math.min(h, 10), d);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const wireMat = new THREE.LineBasicMaterial({ color: purple, transparent: true, opacity: 0.2 });
    const wireBox = new THREE.LineSegments(edgesGeo, wireMat);
    wireBox.position.set(sx, sy + Math.min(h, 10) / 2, sz);
    placementSpotMeshes.add(wireBox);

    const dotGeo = new THREE.SphereGeometry(0.15, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: purple });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(sx, sy + 0.1, sz);
    placementSpotMeshes.add(dot);
  }

  scene.add(placementSpotMeshes);
}

function buildSurfaceSpots(spots) {
  clearGroup(surfaceSpotMeshes);
  if (!spots || spots.length === 0) return;

  surfaceSpotMeshes = new THREE.Group();
  surfaceSpotMeshes.renderOrder = 6;
  const cyan = 0x06b6d4;
  const green = 0x22c55e;
  const red = 0xef4444;

  for (const spot of spots) {
    const sw = spot.surfaceDimensions.width;
    const sd = spot.surfaceDimensions.depth;
    const sy = spot.surfaceY;
    const sx = spot.position.x;
    const sz = spot.position.z;

    const surfGeo = new THREE.PlaneGeometry(sw, sd);
    const surfMat = new THREE.MeshBasicMaterial({
      color: cyan, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
    });
    const surfPlane = new THREE.Mesh(surfGeo, surfMat);
    surfPlane.rotation.x = -Math.PI / 2;
    surfPlane.position.set(sx, sy + 0.05, sz);
    surfaceSpotMeshes.add(surfPlane);

    const borderGeo = new THREE.PlaneGeometry(sw, sd);
    const borderEdges = new THREE.EdgesGeometry(borderGeo);
    const borderMat = new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.8 });
    const borderLine = new THREE.LineSegments(borderEdges, borderMat);
    borderLine.rotation.x = -Math.PI / 2;
    borderLine.position.set(sx, sy + 0.06, sz);
    surfaceSpotMeshes.add(borderLine);

    const aw = spot.availableArea.width;
    const ad = spot.availableArea.depth;
    if (aw > 0 && ad > 0) {
      const availGeo = new THREE.PlaneGeometry(aw, ad);
      const availMat = new THREE.MeshBasicMaterial({
        color: green, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
      });
      const availPlane = new THREE.Mesh(availGeo, availMat);
      availPlane.rotation.x = -Math.PI / 2;
      availPlane.position.set(spot.position.x, sy + 0.07, spot.position.z);
      surfaceSpotMeshes.add(availPlane);
    }

    if (spot.occupancy && spot.occupancy.count > 0) {
      const occDotGeo = new THREE.SphereGeometry(0.08, 8, 6);
      const occDotMat = new THREE.MeshBasicMaterial({ color: red });
      for (const item of spot.occupancy.items) {
        const occDot = new THREE.Mesh(occDotGeo, occDotMat);
        occDot.position.set(item.pos[0], item.pos[1] + 0.1, item.pos[2]);
        surfaceSpotMeshes.add(occDot);
      }
    }

    const dotGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({ color: cyan });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(spot.position.x, sy + 0.12, spot.position.z);
    surfaceSpotMeshes.add(dot);
  }

  scene.add(surfaceSpotMeshes);
}

function handleNavmeshEvent(nm) {
  if (!nm || nm.generation === lastGeneration) return;
  lastGeneration = nm.generation;
  buildNavMesh(nm.positions, nm.indices);
  buildJumpLinks(nm.jumpLinks);
  buildRegionBox(nm.regionCenter, nm.regionHalfSize);
  buildPlacementSpots(nm.placementSpots);
  buildSurfaceSpots(nm.surfaceSpots);

  triCountEl.textContent = (nm.indices.length / 3).toLocaleString();
  linkCountEl.textContent = nm.jumpLinks.length.toString();
  generationEl.textContent = nm.generation.toString();
  regionCenterEl.textContent = nm.regionCenter
    ? fmt(nm.regionCenter.x) + ', ' + fmt(nm.regionCenter.z)
    : '-';
  regionSizeEl.textContent = nm.regionHalfSize * 2 + 'u';
  spotsCountEl.textContent = nm.placementSpots ? nm.placementSpots.length.toString() : '0';
  surfaceCountEl.textContent = nm.surfaceSpots ? nm.surfaceSpots.length.toString() : '0';
}

function handleAgentEvent(agent) {
  if (!agent) return;
  const p = agent.position;
  agentMarker.position.set(p.x, p.y + 0.4, p.z);
  agentMarker.visible = true;
  agentRing.position.set(p.x, p.y + 0.03, p.z);
  agentRing.visible = true;

  agentPosEl.textContent = fmt(p.x) + ', ' + fmt(p.y) + ', ' + fmt(p.z);
  agentMovingEl.textContent = agent.isMoving ? 'Yes' : 'No';
  agentMovingEl.style.color = agent.isMoving ? '#3b82f6' : '#6b7280';

  buildPath(agent.path, agent.waypointIndex);
  pathCountEl.textContent = agent.path ? agent.path.length.toString() : '0';

  if (!initialCameraSet) {
    initialCameraSet = true;
    controls.target.set(p.x, p.y, p.z);
    camera.position.set(p.x, p.y + 35, p.z + 35);
    controls.update();
  }

  if (followTarget === 'agent') {
    controls.target.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.1);
  }
}

let latestUsers = [];

function handleUsersEvent(users) {
  if (!users) return;
  latestUsers = users;

  const incomingIds = new Set(users.map(u => u.id));
  for (const id of userMarkers.keys()) {
    if (!incomingIds.has(id)) removeUserMarker(id);
  }
  for (const u of users) {
    if (userMarkers.has(u.id)) {
      updateUserMarker(u.id, u.username, u.position);
    } else {
      addUserMarker(u.id, u.username, u.position);
    }
  }

  playerCountEl.textContent = users.length.toString();

  if (typeof followTarget === 'number') {
    const found = users.find(u => u.id === followTarget);
    if (!found) {
      followTarget = 'agent';
      followTargetEl.textContent = 'Agent';
    }
  }
}

function connectSSE() {
  const es = new EventSource(BRIDGE_URL + '/navmesh-stream');

  es.addEventListener('navmesh', (e) => {
    handleNavmeshEvent(JSON.parse(e.data));
  });

  es.addEventListener('agent', (e) => {
    handleAgentEvent(JSON.parse(e.data));
  });

  es.addEventListener('users', (e) => {
    handleUsersEvent(JSON.parse(e.data));
  });

  es.onopen = () => {
    statusDot.className = 'status-dot status-ok';
    statusText.textContent = 'Connected (SSE)';
    statusText.style.color = '#22c55e';
  };

  es.onerror = () => {
    statusDot.className = 'status-dot status-err';
    statusText.textContent = 'Reconnecting\\u2026';
    statusText.style.color = '#ef4444';
  };
}

let pulseTime = 0;

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  pulseTime += 0.03;
  if (agentRing.visible) {
    const s = 1 + Math.sin(pulseTime) * 0.15;
    agentRing.scale.set(s, s, s);
    ringMat.opacity = 0.3 + Math.sin(pulseTime) * 0.15;
  }

  for (const [, entry] of userMarkers) {
    const s = 1 + Math.sin(pulseTime * 0.8) * 0.12;
    entry.ring.scale.set(s, s, s);
    entry.ringMat.opacity = 0.25 + Math.sin(pulseTime * 0.8) * 0.12;
  }

  if (typeof followTarget === 'number') {
    const u = latestUsers.find(u => u.id === followTarget);
    if (u) {
      controls.target.lerp(new THREE.Vector3(u.position.x, u.position.y, u.position.z), 0.1);
    }
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    followTarget = followTarget === 'agent' ? null : 'agent';
    followTargetEl.textContent = followTarget === 'agent' ? 'Agent' : 'None';
  }
});

renderer.domElement.addEventListener('click', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const targets = [];
  if (agentMarker.visible) targets.push(agentMarker);
  for (const [, entry] of userMarkers) targets.push(entry.marker);

  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length > 0) {
    const hit = hits[0].object;
    if (hit === agentMarker) {
      followTarget = 'agent';
      followTargetEl.textContent = 'Agent';
    } else if (hit.userData && hit.userData.type === 'user') {
      followTarget = hit.userData.userId;
      const u = latestUsers.find(u => u.id === followTarget);
      followTargetEl.textContent = u ? (u.username || 'Player ' + u.id) : 'Player ' + followTarget;
    }
  } else {
    followTarget = null;
    followTargetEl.textContent = 'None';
  }
});

animate();
connectSSE();
</script>
</body>
</html>`;
}

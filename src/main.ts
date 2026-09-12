import * as THREE from "three";
import "./style.css";
import { BLOCK_ORDER } from "./game/blocks";
import { InputManager } from "./game/input";
import { VoxelInteractor } from "./game/interactor";
import { PlayerController } from "./game/player";
import type { BlockId } from "./game/types";
import { createStarterWorld } from "./game/world-generator";
import { VoxelWorld } from "./game/world";
import { VoxelWorldRenderer } from "./game/world-renderer";
import { Hud } from "./ui/hud";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app not found");
}

app.innerHTML = `
  <canvas id="game-canvas" aria-label="nomio voxel garden"></canvas>
  <div id="ui"></div>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const ui = document.querySelector<HTMLDivElement>("#ui");
if (!canvas || !ui) {
  throw new Error("nomio game shell not found");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
scene.fog = new THREE.Fog(0x101820, 18, 42);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const hemiLight = new THREE.HemisphereLight(0xd9eff0, 0x283741, 2.1);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xffe0b2, 3.2);
sun.position.set(-10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
scene.add(sun);

const world = createStarterWorld();
const worldRenderer = new VoxelWorldRenderer(scene, world);
const player = new PlayerController(camera, world);

let selectedBlock: BlockId = BLOCK_ORDER[0];
let selectedIndex = 0;
const selectBlockByIndex = (index: number): void => {
  const id = BLOCK_ORDER[index];
  if (!id) {
    return;
  }
  selectedIndex = index;
  selectedBlock = id;
  hud.selectBlock(id);
};

const input = new InputManager(canvas, {
  onBlockHotkey: (slot) => selectBlockByIndex(slot),
  onCycleBlock: (direction) =>
    selectBlockByIndex((selectedIndex + direction + BLOCK_ORDER.length) % BLOCK_ORDER.length),
  onPointerLockChange: (locked) => hud.setPointerLocked(locked),
});

const hud = new Hud(ui, {
  onSelectBlock: (id) => selectBlockByIndex(BLOCK_ORDER.indexOf(id)),
  onReset: () => {
    resetWorld();
  },
  onStart: () => input.requestPointerLock(),
  onAction: (action) => input.queueAction(action),
  onMoveButton: (direction, active) => input.setVirtualMove(direction, active),
});

const interactor = new VoxelInteractor(camera, world, worldRenderer, {
  getPlayerBounds: () => VoxelWorld.playerBounds(player.position),
  onWorldChanged: () => hud.setBlockCount(world.size),
});

const resetWorld = (): void => {
  const freshWorld = createStarterWorld();
  copyWorld(freshWorld, world);
  worldRenderer.sync();
  player.reset();
  interactor.update();
  hud.setBlockCount(world.size);
};

const copyWorld = (source: VoxelWorld, target: VoxelWorld): void => {
  const existing: { x: number; y: number; z: number }[] = [];
  target.forEach((cell) => existing.push(cell));
  for (const position of existing) {
    target.remove(position);
  }
  source.forEach((cell) => target.set(cell, cell.id));
};

const handleResize = (): void => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", handleResize);
hud.selectBlock(selectedBlock);
hud.setBlockCount(world.size);
interactor.update();

const timer = new THREE.Timer();
timer.connect(document);
const animate = (): void => {
  requestAnimationFrame(animate);
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.05);
  const inputState = input.consume();

  player.update(delta, inputState);
  if (player.position.y < -10) {
    player.reset();
  }

  interactor.update();
  for (const action of inputState.actions) {
    if (action === "break") {
      interactor.breakTarget();
    } else {
      interactor.placeBlock(selectedBlock);
    }
  }

  const target = interactor.currentTarget;
  hud.setTarget(
    target
      ? `${target.position.x} / ${target.position.y} / ${target.position.z}`
      : "scan the island",
  );
  renderer.render(scene, camera);
};

animate();

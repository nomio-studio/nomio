export interface GameShell {
  canvas: HTMLCanvasElement;
  ui: HTMLDivElement;
}

const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required game shell element not found: ${selector}`);
  }
  return element;
};

export const createGameShell = (root: HTMLElement): GameShell => {
  root.innerHTML = `
    <canvas id="game-canvas" aria-label="Nomio voxel garden"></canvas>
    <div id="ui"></div>
  `;

  return {
    canvas: requireElement<HTMLCanvasElement>(root, "#game-canvas"),
    ui: requireElement<HTMLDivElement>(root, "#ui"),
  };
};

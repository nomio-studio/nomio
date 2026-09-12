import { GameSession, type GameSessionOptions } from "../game/game-session";
import { createGameShell, type GameShell } from "../ui/game-shell";

export interface NomioApplicationOptions extends Omit<GameSessionOptions, "shell"> {
  root: HTMLElement;
}

export class NomioApplication {
  private readonly shell: GameShell;
  private readonly session: GameSession;

  public constructor(options: NomioApplicationOptions) {
    this.shell = createGameShell(options.root);
    this.session = new GameSession({
      shell: this.shell,
      registry: options.registry,
      config: options.config,
    });
  }

  public start(): void {
    this.session.start();
  }

  public dispose(): void {
    this.session.dispose();
  }
}

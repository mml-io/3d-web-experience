import type { UpdatableConfig } from "./Networked3dWebExperienceClient";

export type ClientEventMap = {
  chat: {
    username: string;
    message: string;
    fromConnectionId: number;
    userId: string;
    isLocal: boolean;
  };
  userJoined: { connectionId: number; userId: string; username: string | null };
  userLeft: { connectionId: number; userId: string; username: string | null };
  configChanged: Partial<UpdatableConfig>;
  ready: void;
  disposed: void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (...args: any[]) => void;

export class ClientEventEmitter {
  private handlers = new Map<keyof ClientEventMap, Set<EventHandler>>();

  on<K extends keyof ClientEventMap>(event: K, handler: (data: ClientEventMap[K]) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
  }

  off<K extends keyof ClientEventMap>(event: K, handler: (data: ClientEventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  protected emit<K extends keyof ClientEventMap>(
    event: K,
    ...args: ClientEventMap[K] extends void ? [] : [ClientEventMap[K]]
  ): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      handler(...args);
    }
  }

  /** Remove all registered event handlers. Called during dispose to prevent leaks. */
  protected clearAllHandlers(): void {
    this.handlers.clear();
  }
}

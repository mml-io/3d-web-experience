import type {
  Networked3dWebExperienceClient,
  UpdatableConfig,
} from "./Networked3dWebExperienceClient";

export interface UIPlugin {
  mount(container: HTMLElement, client: Networked3dWebExperienceClient): void;
  dispose(): void;

  /**
   * Called automatically by the client whenever the updatable config changes
   * (e.g. avatar configuration, spawn settings, environment). Implementing
   * this hook is the preferred alternative to manually subscribing to the
   * `"configChanged"` event — the client handles subscription/cleanup for you.
   *
   * Note: if you implement this hook you should **not** also subscribe to
   * `"configChanged"` via `client.on()`, or your handler will fire twice.
   */
  onConfigChanged?(config: Partial<UpdatableConfig>): void;
}

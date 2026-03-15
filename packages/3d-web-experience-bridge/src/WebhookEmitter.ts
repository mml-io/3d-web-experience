import dns from "dns";
import { isIP } from "net";

import type { WorldConnection, WorldEvent } from "@mml-io/3d-web-experience-client";

import type { AvatarController } from "./AvatarController";
import { debug } from "./logger";

/**
 * Check if an IPv4 or IPv6 address string is private/loopback/link-local.
 */
function isPrivateIP(host: string): boolean {
  // IPv4 private ranges
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local
    if (parts[0] === 0) return true; // 0.0.0.0/8
    return false;
  }

  // IPv6 private ranges
  if (isIP(host) === 6) {
    const lower = host.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower === "::") return true;
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const v4Match = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Match) return isPrivateIP(v4Match[1]);
    return false;
  }

  return false;
}

/**
 * Check if a hostname resolves to a private/loopback/link-local address.
 * Prevents SSRF by rejecting webhooks that target internal services.
 *
 * For hostnames (non-IP), performs DNS resolution to check the actual
 * resolved addresses, preventing DNS rebinding attacks.
 */
async function isPrivateHost(hostname: string): Promise<boolean> {
  // Normalise IPv6-bracketed addresses
  const host = hostname.replace(/^\[|\]$/g, "");

  // Direct IP addresses — check immediately
  if (isIP(host)) {
    return isPrivateIP(host);
  }

  // Hostname checks (known private suffixes)
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  // Resolve the hostname and check all returned addresses
  try {
    const addresses = await dns.promises.resolve(host);
    for (const addr of addresses) {
      if (isPrivateIP(addr)) return true;
    }
  } catch {
    // DNS resolution failed — allow the request (it will fail at fetch time)
  }

  return false;
}

export type WebhookEvent = {
  type: string;
  timestamp: number;
  [key: string]: any;
};

export type WebhookConfig = {
  url: string;
  token?: string;
  events?: string[];
  batchMs?: number;
};

/**
 * Pushes world events to an external webhook URL.
 *
 * Events are batched within a configurable window (default 2s) so that
 * rapid-fire events are delivered in a single HTTP POST. Each payload
 * includes the batch of events plus a snapshot of the current world context.
 */
const MAX_PENDING_EVENTS = 500;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 10;

export class WebhookEmitter {
  private url: string;
  private token?: string;
  private eventFilter: Set<string>;
  private batchMs: number;
  private pendingEvents: WebhookEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private worldConnection: WorldConnection;
  private avatarController: AvatarController;
  private worldEventListener: (event: WorldEvent) => void;
  private arrivedListener: () => void;

  static async create(
    config: WebhookConfig,
    worldConnection: WorldConnection,
    avatarController: AvatarController,
  ): Promise<WebhookEmitter> {
    // Validate that the webhook URL uses http or https
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw new Error(`Invalid webhook URL: ${config.url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Webhook URL must use http or https protocol, got: ${parsed.protocol}`);
    }
    if (await isPrivateHost(parsed.hostname)) {
      throw new Error(`Webhook URL must not target a private/loopback address: ${parsed.hostname}`);
    }
    return new WebhookEmitter(config, worldConnection, avatarController);
  }

  private constructor(
    config: WebhookConfig,
    worldConnection: WorldConnection,
    avatarController: AvatarController,
  ) {
    this.url = config.url;
    this.token = config.token;
    this.eventFilter = new Set(config.events ?? ["chat", "user_joined", "user_left", "arrival"]);
    this.batchMs = config.batchMs ?? 2000;
    this.worldConnection = worldConnection;
    this.avatarController = avatarController;

    this.worldEventListener = (event: WorldEvent) => {
      if (event.type === "chat") {
        this.enqueue({
          type: "chat",
          timestamp: Date.now(),
          username: event.message.username,
          message: event.message.message,
        });
      } else if (event.type === "user_joined") {
        this.enqueue({
          type: "user_joined",
          timestamp: Date.now(),
          userId: event.userId,
          username: event.username,
        });
      } else if (event.type === "user_left") {
        this.enqueue({
          type: "user_left",
          timestamp: Date.now(),
          userId: event.userId,
          username: event.username,
        });
      }
    };
    worldConnection.addEventListener(this.worldEventListener);

    this.arrivedListener = () => {
      this.enqueue({ type: "arrival", timestamp: Date.now() });
    };
    avatarController.on("arrived", this.arrivedListener);

    debug(
      `[webhook] Emitter active → ${this.url} (events: ${[...this.eventFilter].join(", ")}, batch: ${this.batchMs}ms)`,
    );
  }

  async dispose(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.worldConnection.removeEventListener(this.worldEventListener);
    this.avatarController.off("arrived", this.arrivedListener);
    if (this.pendingEvents.length > 0) {
      await this.flush();
    }
    debug("[webhook] Emitter disposed");
  }

  private enqueue(event: WebhookEvent): void {
    if (!this.eventFilter.has(event.type)) return;
    if (this.pendingEvents.length >= MAX_PENDING_EVENTS) {
      // Drop the newest event (the one being enqueued) rather than the oldest.
      // Older events provide context that's harder to reconstruct, while the
      // newest event is likely part of a burst that will continue arriving.
      console.warn(
        `[webhook] Event queue full (${MAX_PENDING_EVENTS}), dropping newest event: ${event.type}`,
      );
      return;
    }
    this.pendingEvents.push(event);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flush(), this.batchMs);
    }
  }

  private requeue(events: WebhookEvent[]): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      console.warn(
        `[webhook] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — dropping ${events.length} events`,
      );
      return;
    }
    // Re-add events at the front, respecting the max pending limit
    const available = MAX_PENDING_EVENTS - this.pendingEvents.length;
    if (available > 0) {
      this.pendingEvents.unshift(...events.slice(0, available));
    }
    // Schedule a retry with exponential backoff and jitter
    if (!this.batchTimer && this.pendingEvents.length > 0) {
      const backoff = Math.min(
        this.batchMs * Math.pow(2, this.consecutiveFailures - 1),
        MAX_RETRY_DELAY_MS,
      );
      const jitter = backoff * (0.5 + Math.random() * 0.5);
      this.batchTimer = setTimeout(() => this.flush(), jitter);
    }
  }

  private async flush(): Promise<void> {
    this.batchTimer = null;
    if (this.pendingEvents.length === 0) return;

    const events = this.pendingEvents.splice(0);
    const pos = this.avatarController.getPosition();
    const others = this.worldConnection.getOtherUsers();

    const payload = {
      events,
      context: {
        position: pos,
        isMoving: this.avatarController.isMoving(),
        nearbyUsers: others.map((u) => ({
          connectionId: u.connectionId,
          username: u.username,
          position: u.position,
        })),
      },
      timestamp: Date.now(),
    };

    try {
      // Re-validate the target host immediately before fetching to prevent
      // SSRF via DNS rebinding (no TOCTOU gap between check and fetch)
      const parsed = new URL(this.url);
      if (await isPrivateHost(parsed.hostname)) {
        console.error(
          `[webhook] Refusing to POST to private/loopback address: ${parsed.hostname} — dropping ${events.length} events`,
        );
        return;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }
      const res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (res.status >= 500) {
          console.error(
            `[webhook] POST failed (server error): ${res.status} ${res.statusText} — requeueing ${events.length} events`,
          );
          this.requeue(events);
        } else {
          // 4xx client errors are not transient — log and drop events
          console.error(
            `[webhook] POST failed (client error): ${res.status} ${res.statusText} — dropping ${events.length} events`,
          );
        }
      } else {
        this.consecutiveFailures = 0;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[webhook] POST error: ${message}`);
      // Re-queue events on network errors (transient failures)
      this.requeue(events);
    }
  }
}

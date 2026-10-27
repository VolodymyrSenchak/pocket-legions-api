import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../utils/logger";

export type BusReason = "state" | "presence";

/** Relay messages never carry game data — only "session X changed". */
export interface BusMessage {
  version: number;
  reason: BusReason;
}

export type BusHandler = (message: BusMessage) => void;

/** Cross-instance "session changed" relay. */
export interface SessionBus {
  publish(sessionId: string, message: BusMessage): Promise<void>;
  /** One handler per session per instance; subscribing again replaces it. */
  subscribe(sessionId: string, handler: BusHandler): void;
  unsubscribe(sessionId: string): void;
}

function isBusMessage(value: unknown): value is BusMessage {
  const candidate = value as BusMessage | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.version === "number" &&
    (candidate.reason === "state" || candidate.reason === "presence")
  );
}

/** Shared "network" for in-memory buses; several buses on one hub behave like several instances. */
export class InMemoryBusHub {
  readonly published: { sessionId: string; message: BusMessage }[] = [];
  private readonly subscribers = new Map<string, Set<BusHandler>>();
  private messagesToDrop = 0;

  /** Test hook: the next `count` published messages are lost. */
  dropNextMessages(count: number): void {
    this.messagesToDrop += count;
  }

  deliver(sessionId: string, message: BusMessage): void {
    this.published.push({ sessionId, message });
    if (this.messagesToDrop > 0) {
      this.messagesToDrop--;
      return;
    }
    for (const handler of this.subscribers.get(sessionId) ?? []) {
      queueMicrotask(() => handler({ ...message }));
    }
  }

  add(sessionId: string, handler: BusHandler): void {
    const handlers = this.subscribers.get(sessionId) ?? new Set();
    handlers.add(handler);
    this.subscribers.set(sessionId, handlers);
  }

  remove(sessionId: string, handler: BusHandler): void {
    const handlers = this.subscribers.get(sessionId);
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      this.subscribers.delete(sessionId);
    }
  }
}

/** For tests and local single-process dev. */
export class InMemoryBus implements SessionBus {
  private readonly handlers = new Map<string, BusHandler>();

  constructor(private readonly hub = new InMemoryBusHub()) {}

  async publish(sessionId: string, message: BusMessage): Promise<void> {
    this.hub.deliver(sessionId, message);
  }

  subscribe(sessionId: string, handler: BusHandler): void {
    this.unsubscribe(sessionId);
    this.handlers.set(sessionId, handler);
    this.hub.add(sessionId, handler);
  }

  unsubscribe(sessionId: string): void {
    const handler = this.handlers.get(sessionId);
    if (handler) {
      this.hub.remove(sessionId, handler);
      this.handlers.delete(sessionId);
    }
  }
}

/**
 * Supabase Realtime Broadcast on private channels, server-only (service role).
 * Uses two clients: `channel()` returns an existing channel for the same topic, so a temporary
 * publish channel on the subscriber client would tear down the live subscription when removed.
 */
export class SupabaseRealtimeBus implements SessionBus {
  private readonly channels = new Map<string, RealtimeChannel>();

  constructor(private readonly publisher: SupabaseClient, private readonly subscriber: SupabaseClient) {}

  static topic(sessionId: string): string {
    return `pocket-legions-session:${sessionId}`;
  }

  async publish(sessionId: string, message: BusMessage): Promise<void> {
    const channel = this.publisher.channel(SupabaseRealtimeBus.topic(sessionId), { config: { private: true } });
    try {
      // REST call, no subscription needed; rejects on failure
      await channel.httpSend("changed", message);
    } finally {
      await this.publisher.removeChannel(channel);
    }
  }

  subscribe(sessionId: string, handler: BusHandler): void {
    this.unsubscribe(sessionId);
    const channel = this.subscriber
      .channel(SupabaseRealtimeBus.topic(sessionId), { config: { private: true } })
      .on("broadcast", { event: "changed" }, ({ payload }) => {
        if (isBusMessage(payload)) {
          handler(payload);
        }
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          logger.warn("relay-subscribe-failed", { sessionId, status, error });
        }
      });
    this.channels.set(sessionId, channel);
  }

  unsubscribe(sessionId: string): void {
    const channel = this.channels.get(sessionId);
    if (!channel) {
      return;
    }
    this.channels.delete(sessionId);
    this.subscriber.removeChannel(channel).catch((error) => {
      logger.warn("relay-unsubscribe-failed", { sessionId, error });
    });
  }
}

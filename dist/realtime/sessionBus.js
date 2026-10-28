"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseRealtimeBus = exports.InMemoryBus = exports.InMemoryBusHub = void 0;
const logger_1 = require("../utils/logger");
function isBusMessage(value) {
    const candidate = value;
    return (typeof candidate === "object" &&
        candidate !== null &&
        typeof candidate.version === "number" &&
        (candidate.reason === "state" || candidate.reason === "presence"));
}
/** Shared "network" for in-memory buses; several buses on one hub behave like several instances. */
class InMemoryBusHub {
    published = [];
    subscribers = new Map();
    messagesToDrop = 0;
    /** Test hook: the next `count` published messages are lost. */
    dropNextMessages(count) {
        this.messagesToDrop += count;
    }
    deliver(sessionId, message) {
        this.published.push({ sessionId, message });
        if (this.messagesToDrop > 0) {
            this.messagesToDrop--;
            return;
        }
        for (const handler of this.subscribers.get(sessionId) ?? []) {
            queueMicrotask(() => handler({ ...message }));
        }
    }
    add(sessionId, handler) {
        const handlers = this.subscribers.get(sessionId) ?? new Set();
        handlers.add(handler);
        this.subscribers.set(sessionId, handlers);
    }
    remove(sessionId, handler) {
        const handlers = this.subscribers.get(sessionId);
        handlers?.delete(handler);
        if (handlers?.size === 0) {
            this.subscribers.delete(sessionId);
        }
    }
}
exports.InMemoryBusHub = InMemoryBusHub;
/** For tests and local single-process dev. */
class InMemoryBus {
    hub;
    handlers = new Map();
    constructor(hub = new InMemoryBusHub()) {
        this.hub = hub;
    }
    async publish(sessionId, message) {
        this.hub.deliver(sessionId, message);
    }
    subscribe(sessionId, handler) {
        this.unsubscribe(sessionId);
        this.handlers.set(sessionId, handler);
        this.hub.add(sessionId, handler);
    }
    unsubscribe(sessionId) {
        const handler = this.handlers.get(sessionId);
        if (handler) {
            this.hub.remove(sessionId, handler);
            this.handlers.delete(sessionId);
        }
    }
}
exports.InMemoryBus = InMemoryBus;
/**
 * Supabase Realtime Broadcast on private channels, server-only (service role).
 * Uses two clients: `channel()` returns an existing channel for the same topic, so a temporary
 * publish channel on the subscriber client would tear down the live subscription when removed.
 */
class SupabaseRealtimeBus {
    publisher;
    subscriber;
    channels = new Map();
    constructor(publisher, subscriber) {
        this.publisher = publisher;
        this.subscriber = subscriber;
    }
    static topic(sessionId) {
        return `skirmora-session:${sessionId}`;
    }
    async publish(sessionId, message) {
        const channel = this.publisher.channel(SupabaseRealtimeBus.topic(sessionId), { config: { private: true } });
        try {
            // REST call, no subscription needed; rejects on failure
            await channel.httpSend("changed", message);
        }
        finally {
            await this.publisher.removeChannel(channel);
        }
    }
    subscribe(sessionId, handler) {
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
                logger_1.logger.warn("relay-subscribe-failed", { sessionId, status, error });
            }
        });
        this.channels.set(sessionId, channel);
    }
    unsubscribe(sessionId) {
        const channel = this.channels.get(sessionId);
        if (!channel) {
            return;
        }
        this.channels.delete(sessionId);
        this.subscriber.removeChannel(channel).catch((error) => {
            logger_1.logger.warn("relay-unsubscribe-failed", { sessionId, error });
        });
    }
}
exports.SupabaseRealtimeBus = SupabaseRealtimeBus;
//# sourceMappingURL=sessionBus.js.map
import { PlayerRecord, PresenceMap } from "../models";

/** A player counts as online when seen within this window. */
export const ONLINE_WINDOW_MS = 30_000;

/**
 * Last time the player was seen. A missing presence entry means the player has just joined
 * and the presence write hasn't landed yet, so `joinedAt` is used; `null` means explicitly offline.
 */
export function getLastSeenAt(player: Pick<PlayerRecord, "id" | "joinedAt">, presence: PresenceMap): number | null {
  if (Object.hasOwn(presence, player.id)) {
    const lastSeenAt = presence[player.id];
    return lastSeenAt ? Date.parse(lastSeenAt) : null;
  }
  return Date.parse(player.joinedAt);
}

export function isPlayerOnline(player: Pick<PlayerRecord, "id" | "joinedAt">, presence: PresenceMap, now: Date): boolean {
  const lastSeenAt = getLastSeenAt(player, presence);
  return lastSeenAt !== null && now.getTime() - lastSeenAt < ONLINE_WINDOW_MS;
}

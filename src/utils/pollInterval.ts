import { SessionStatus } from "../models";

const POLL_INTERVAL_MS: Record<SessionStatus, number> = {
  pending: 3000,
  in_progress: 1500,
  finished: 10000,
};

/** Polling interval for the HTTP fallback (the client uses 10 s while the tab is hidden). */
export function getPollIntervalMs(status: SessionStatus): number {
  return POLL_INTERVAL_MS[status];
}

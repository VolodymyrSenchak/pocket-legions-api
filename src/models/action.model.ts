import { z } from "zod";
import type { AnyGameModule } from "../games/gameModule";
import type { Rng } from "../utils/random";

export const actionRequestSchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.unknown().optional(),
});

/** `{ type: 'lobby.start' | '<module.type>.<action>', payload }` */
export type ActionRequest = z.output<typeof actionRequestSchema>;

/** Environment passed to lobby action handlers. */
export interface ActionContext {
  actorId: string;
  now: Date;
  rng: Rng;
  module: AnyGameModule;
}

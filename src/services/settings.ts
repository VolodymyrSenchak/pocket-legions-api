import { z } from "zod";
import { AnyGameModule } from "../games/gameModule";
import { CoreSettings, failure, Result, success } from "../models";

export const DEFAULT_MAX_PLAYERS = 20;

/** Core settings plus the module's, validated together (on create and on `lobby.updateSettings`). */
export function resolveSettings(
  module: AnyGameModule,
  input: Record<string, unknown> = {}
): Result<CoreSettings & Record<string, unknown>> {
  const coreSchema = z.object({
    maxPlayers: z
      .number()
      .int()
      .min(module.minPlayers)
      .max(module.maxPlayers)
      .default(Math.min(DEFAULT_MAX_PLAYERS, module.maxPlayers)),
    allowJoinInProgress: module.allowJoinInProgress === false ? z.literal(false).default(false) : z.boolean().default(true),
  });
  const core = coreSchema.safeParse(input);
  if (!core.success) {
    return failure(z.prettifyError(core.error), "bad-request");
  }
  const game = module.settingsSchema.safeParse({ ...module.defaultSettings, ...input });
  if (!game.success) {
    return failure(z.prettifyError(game.error), "bad-request");
  }
  return success({ ...(game.data as Record<string, unknown>), ...core.data });
}

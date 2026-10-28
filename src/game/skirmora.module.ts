import { DATA_VERSION } from "../engine/version";
import type { GameModule } from "../games/gameModule";
import { onPlayerRemoved, skirmoraActions } from "./skirmora.actions";
import { project, SkirmoraView } from "./skirmora.projection";
import {
  createInitialState,
  Ctx,
  defaultSettings,
  GAME_TYPE,
  SkirmoraSettings,
  SkirmoraState,
  settingsSchema,
} from "./skirmora.state";

/** Skirmora behind `skirmora.<action>` (plan §7). */
export const skirmoraModule: GameModule<SkirmoraState, SkirmoraSettings, SkirmoraView> = {
  type: GAME_TYPE,
  minPlayers: 2,
  maxPlayers: 4,
  allowJoinInProgress: false,
  settingsSchema,
  defaultSettings,
  createInitialState: (ctx) => createInitialState(ctx as Ctx),
  // handlers read the core settings too (Settings = SkirmoraSettings & CoreSettings)
  actions: skirmoraActions as GameModule<SkirmoraState, SkirmoraSettings, SkirmoraView>["actions"],
  onPlayerRemoved: (ctx, state, playerId) => onPlayerRemoved(ctx as Ctx, state, playerId),
  project: (state, viewerId, ctx) => project(state, viewerId, ctx as Ctx),
  getHistory: (state) => state.history,
  rejectSession: (settings) =>
    settings.dataVersion === DATA_VERSION ? null : { message: "The game was updated — start a new room", code: "outdated" },
  publicInfo: (settings) => ({ mapId: settings.mapId, mode: settings.mode, budget: settings.budget }),
};

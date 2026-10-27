import type { GameModule } from "../games/gameModule";
import { onPlayerRemoved, pocketLegionsActions } from "./pocketLegions.actions";
import { project, PocketLegionsView } from "./pocketLegions.projection";
import {
  createInitialState,
  Ctx,
  defaultSettings,
  GAME_TYPE,
  PocketLegionsSettings,
  PocketLegionsState,
  settingsSchema,
} from "./pocketLegions.state";

/** Pocket Legions behind `pocket-legions.<action>` (plan §7). */
export const pocketLegionsModule: GameModule<PocketLegionsState, PocketLegionsSettings, PocketLegionsView> = {
  type: GAME_TYPE,
  minPlayers: 2,
  maxPlayers: 4,
  allowJoinInProgress: false,
  settingsSchema,
  defaultSettings,
  createInitialState: (ctx) => createInitialState(ctx as Ctx),
  // handlers read the core settings too (Settings = PocketLegionsSettings & CoreSettings)
  actions: pocketLegionsActions as GameModule<PocketLegionsState, PocketLegionsSettings, PocketLegionsView>["actions"],
  onPlayerRemoved: (ctx, state, playerId) => onPlayerRemoved(ctx as Ctx, state, playerId),
  project: (state, viewerId, ctx) => project(state, viewerId, ctx as Ctx),
  getHistory: (state) => state.history,
};

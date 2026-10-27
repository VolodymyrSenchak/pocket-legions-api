import { z } from "zod";
import type { GameModule } from "../games/gameModule";

// Phase 0 placeholder; replaced by the real module in Phase 3.
export const pocketLegionsModule: GameModule<Record<string, never>, Record<string, never>, null> = {
  type: "pocket-legions",
  minPlayers: 2,
  maxPlayers: 4,
  allowJoinInProgress: false,
  settingsSchema: z.object({}),
  defaultSettings: {},
  createInitialState: () => ({ isSuccess: true, result: {} }),
  actions: {},
  project: () => null,
};

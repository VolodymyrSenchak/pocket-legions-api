import { z } from "zod";
import { success } from "../models";
import { defineGameAction, GameModule } from "../games/gameModule";

const settingsSchema = z.object({ step: z.number().int().min(1).default(1) });
type TestGameSettings = z.output<typeof settingsSchema>;

export interface TestGameState {
  counter: number;
  joined: string[];
  removed: string[];
  secrets: Record<string, string>;
}

export interface TestGameView {
  counter: number;
  joined: string[];
  removed: string[];
  mySecret: string | null;
}

/** Minimal game used to exercise the session pipeline without Skirmora. */
export const testGameModule: GameModule<TestGameState, TestGameSettings, TestGameView> = {
  type: "test-game",
  minPlayers: 2,
  maxPlayers: 20,
  settingsSchema,
  defaultSettings: { step: 1 },
  createInitialState: () => success({ counter: 0, joined: [], removed: [], secrets: {} }),
  actions: {
    increment: defineGameAction(z.object({ by: z.number().int().optional() }), (ctx, state: TestGameState, { by }) =>
      success({ state: { ...state, counter: state.counter + (by ?? (ctx.settings as TestGameSettings).step) } })
    ),
    whisper: defineGameAction(z.object({ text: z.string().min(1) }), (ctx, state: TestGameState, { text }) =>
      success({ state: { ...state, secrets: { ...state.secrets, [ctx.actorId]: text } } })
    ),
    finish: defineGameAction(z.object({}), (_ctx, state: TestGameState) => success({ state, finished: true })),
  },
  onPlayerJoined: (_ctx, state, playerId) => ({ ...state, joined: [...state.joined, playerId] }),
  onPlayerRemoved: (_ctx, state, playerId) => ({ state: { ...state, removed: [...state.removed, playerId] } }),
  project: (state, viewerId) => ({
    counter: state.counter,
    joined: [...state.joined],
    removed: [...state.removed],
    mySecret: state.secrets[viewerId] ?? null,
  }),
  getHistory: (state) => [`counter=${state.counter}`],
};

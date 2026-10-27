import { z } from "zod";
import { equippedItems, heroBonuses, validateArmy, validateDeployment } from "../engine/army";
import {
  ActAction,
  applyAct,
  applyHeroAbility,
  applyTimeout,
  BattleSetup,
  createBattle,
  eliminateSeat,
  StepResult,
  zoneFor,
} from "../engine/battle";
import { SLOTS } from "../engine/data/items";
import { RACE_IDS } from "../engine/data/races";
import { getMap } from "../engine/grid";
import type { BattleEnv, BattleState, GameEvent } from "../engine/state";
import type { Army, Cell } from "../engine/types";
import { DATA_VERSION } from "../engine/version";
import type { GameAction, GameTransition } from "../games/gameModule";
import type { Result } from "../models/result";
import {
  appendHistory,
  AUTO_SURRENDER_TIMEOUTS,
  Ctx,
  fail,
  ok,
  PocketLegionsState,
  Seat,
  seatOf,
  Settings,
} from "./pocketLegions.state";

// Plan §7.3. Every handler is pure: it returns a new state built from a copy.

type Transition = Result<GameTransition<PocketLegionsState>>;
type Handler<T> = (ctx: Ctx, state: PocketLegionsState, payload: T) => Transition;

/** Wraps a handler with the checks every action shares: data version and seat. */
function defineAction<T>(schema: z.ZodType<T>, handle: Handler<T>): GameAction<PocketLegionsState, Settings> {
  return {
    schema,
    handle: (ctx, state, payload) => {
      // TODO(plan §12.4): a balance deploy ends running games; keep the previous data module for 24 h if that hurts
      if (ctx.settings.dataVersion !== DATA_VERSION) {
        return fail("The game was updated — start a new room", "conflict", "outdated");
      }
      if (state.phase === "over") return fail("The game is over", "conflict");
      return handle(ctx, structuredClone(state), payload as T);
    },
  };
}

const next = (state: PocketLegionsState, finished = false): Transition => ok({ state, ...(finished ? { finished } : {}) });

function requireSeat(ctx: Ctx, state: PocketLegionsState): Seat | Transition {
  const seat = seatOf(state, ctx.actorId);
  return seat ?? fail("You have no seat in this game", "forbidden");
}

function requirePhase(state: PocketLegionsState, phase: PocketLegionsState["phase"]): Transition | null {
  return state.phase === phase ? null : fail(`Not possible in the ${state.phase} phase`, "conflict");
}

const isSeat = (value: Seat | Transition): value is Seat => (value as Seat).playerId !== undefined;

function battleEnv(ctx: Ctx): BattleEnv {
  return { rng: ctx.rng, nowMs: ctx.now.getTime(), turnSeconds: ctx.settings.turnSeconds };
}

/** Teams must both be non-empty with at most 2 players (2 vs 2, or 2 vs 1 after someone left). */
function teamsProblem(state: PocketLegionsState, ctx: Ctx): string | null {
  if (ctx.settings.mode !== "teams") return null;
  const sizes = [0, 1].map((team) => state.seats.filter((seat) => seat.team === team).length);
  return sizes.every((size) => size >= 1 && size <= 2) ? null : "Teams must be 2 vs 2";
}

export function deployZoneOf(ctx: Pick<Ctx, "settings">, state: PocketLegionsState, seat: Seat): Cell[] {
  const extraRows = seat.army && seat.raceId ? heroBonuses(seat.raceId, equippedItems(seat.army)).fx.deployRows : 0;
  return zoneFor(getMap(ctx.settings.mapId), ctx.settings.mode, state.seats, seat.seat, extraRows);
}

/** Army → deploy once every seat is ready. */
function maybeStartDeploy(state: PocketLegionsState): void {
  if (state.phase === "army" && state.seats.every((seat) => seat.armyReady)) {
    state.phase = "deploy";
  }
}

/** Deploy → battle once every seat is ready: random first seat, `turnStarted`. */
function maybeStartBattle(ctx: Ctx, state: PocketLegionsState): void {
  if (state.phase !== "deploy" || !state.seats.every((seat) => seat.deployReady)) return;
  const setup: BattleSetup = {
    mapId: ctx.settings.mapId,
    mode: ctx.settings.mode,
    sides: state.seats.map((seat) => ({
      seat: seat.seat,
      team: seat.team,
      raceId: seat.raceId!,
      army: seat.army!,
      deployment: seat.deployment!,
    })),
  };
  const { battle, events } = createBattle(setup, battleEnv(ctx));
  state.phase = "battle";
  state.battle = battle;
  state.history = appendHistory(state, events);
}

/** After an engine step: log the events, mirror eliminations, end the game when the battle is over. */
function afterBattleStep(state: PocketLegionsState, events: GameEvent[]): Transition {
  const battle = state.battle!;
  state.history = appendHistory(state, events);
  for (const side of battle.sides) {
    const seat = state.seats.find((candidate) => candidate.seat === side.seat);
    if (seat) seat.eliminated = side.eliminated;
  }
  if (battle.result) {
    state.phase = "over";
    state.result = { ...battle.result };
    return next(state, true);
  }
  return next(state);
}

function stepFailure(result: Extract<StepResult, { ok: false }>): Transition {
  return result.code === "not-your-turn"
    ? fail("It is not your turn", "conflict", "not-your-turn")
    : fail(`Illegal action: ${result.reason}`, "bad-request", "illegal-action", result.reason);
}

const cellSchema = z.object({ x: z.number().int(), y: z.number().int() });
const id = z.string().min(1).max(40);

const itemsSchema = z.object(
  Object.fromEntries(SLOTS.filter((slot) => slot !== "ring").map((slot) => [slot, id.optional()])) as Record<
    Exclude<(typeof SLOTS)[number], "ring">,
    z.ZodOptional<z.ZodString>
  >
);

export const pocketLegionsActions: Record<string, GameAction<PocketLegionsState, Settings>> = {
  pickRace: defineAction(z.object({ raceId: z.enum(RACE_IDS) }), (ctx, state, { raceId }) => {
    const seat = requireSeat(ctx, state);
    if (!isSeat(seat)) return seat;
    const wrongPhase = requirePhase(state, "army");
    if (wrongPhase) return wrongPhase;
    if (seat.armyReady) return fail("Unready first to change the race", "conflict");
    seat.raceId = raceId;
    seat.army = null;
    return next(state);
  }),

  setTeam: defineAction(z.object({ playerId: id, team: z.union([z.literal(0), z.literal(1)]) }), (ctx, state, { playerId, team }) => {
    if (ctx.actorId !== ctx.hostPlayerId) return fail("Only the host can do this", "forbidden");
    const wrongPhase = requirePhase(state, "army");
    if (wrongPhase) return wrongPhase;
    if (ctx.settings.mode !== "teams") return fail("Teams exist only in 2 vs 2", "conflict");
    const seat = seatOf(state, playerId);
    if (!seat) return fail("Player not found", "not-found");
    seat.team = team;
    return next(state);
  }),

  submitArmy: defineAction(
    z.object({
      stacks: z.array(z.object({ unitId: id, count: z.number().int() })).max(12),
      items: itemsSchema.default({}),
      rings: z.array(id).max(4).default([]),
    }),
    (ctx, state, payload) => {
      const seat = requireSeat(ctx, state);
      if (!isSeat(seat)) return seat;
      const wrongPhase = requirePhase(state, "army");
      if (wrongPhase) return wrongPhase;
      if (!seat.raceId) return fail("Pick a race first", "bad-request", "invalid-army", "no-race");
      const teams = teamsProblem(state, ctx);
      if (teams) return fail(teams, "conflict", undefined, "unbalanced-teams");
      const army = payload as Army;
      const check = validateArmy(army, seat.raceId, {
        budget: ctx.settings.budget,
        mapSize: getMap(ctx.settings.mapId).size,
        playerCount: state.seats.length,
      });
      if (!check.ok) return fail(`Invalid army: ${check.reason}`, "bad-request", "invalid-army", check.reason);
      seat.army = { stacks: army.stacks.map((stack) => ({ ...stack })), items: { ...army.items }, rings: [...army.rings] };
      seat.armyReady = true;
      maybeStartDeploy(state);
      return next(state);
    }
  ),

  unready: defineAction(z.object({}), (ctx, state) => {
    const seat = requireSeat(ctx, state);
    if (!isSeat(seat)) return seat;
    if (state.phase === "army") seat.armyReady = false;
    else if (state.phase === "deploy") seat.deployReady = false;
    else return fail("Not possible in the battle", "conflict");
    return next(state);
  }),

  submitDeploy: defineAction(
    z.object({ placements: z.array(z.object({ stackIndex: z.number().int(), x: z.number().int(), y: z.number().int() })).max(12) }),
    (ctx, state, { placements }) => {
      const seat = requireSeat(ctx, state);
      if (!isSeat(seat)) return seat;
      const wrongPhase = requirePhase(state, "deploy");
      if (wrongPhase) return wrongPhase;
      const check = validateDeployment(getMap(ctx.settings.mapId), deployZoneOf(ctx, state, seat), seat.army!.stacks.length, placements);
      if (!check.ok) return fail(`Invalid deployment: ${check.reason}`, "bad-request", "invalid-deploy", check.reason);
      seat.deployment = placements.map((placement) => ({ ...placement }));
      seat.deployReady = true;
      maybeStartBattle(ctx, state);
      return next(state);
    }
  ),

  act: defineAction(
    z.object({
      stackId: id,
      kind: z.enum(["move", "attack", "shoot", "ability", "defend"]),
      cell: cellSchema.optional(),
      target: id.optional(),
    }),
    (ctx, state, payload) => {
      const seat = requireSeat(ctx, state);
      if (!isSeat(seat)) return seat;
      const wrongPhase = requirePhase(state, "battle");
      if (wrongPhase) return wrongPhase;
      const result = applyAct(state.battle!, seat.seat, payload as ActAction, battleEnv(ctx));
      if (!result.ok) return stepFailure(result);
      seat.timeoutsInRow = 0;
      return afterBattleStep(state, result.events);
    }
  ),

  heroAbility: defineAction(
    z.object({ target: id.optional(), ally: id.optional(), cell: cellSchema.optional(), cells: z.array(cellSchema).max(3).optional() }),
    (ctx, state, payload) => {
      const seat = requireSeat(ctx, state);
      if (!isSeat(seat)) return seat;
      const wrongPhase = requirePhase(state, "battle");
      if (wrongPhase) return wrongPhase;
      const result = applyHeroAbility(state.battle!, seat.seat, payload, battleEnv(ctx));
      if (!result.ok) return stepFailure(result);
      return afterBattleStep(state, result.events);
    }
  ),

  claimTimeout: defineAction(z.object({}), (ctx, state) => {
    const claimer = requireSeat(ctx, state);
    if (!isSeat(claimer)) return claimer;
    const wrongPhase = requirePhase(state, "battle");
    if (wrongPhase) return wrongPhase;
    const battle: BattleState = state.battle!;
    if (ctx.now.getTime() < Date.parse(battle.turnDeadline)) {
      return fail("The turn has not timed out yet", "conflict", "too-early");
    }
    const late = state.seats.find((seat) => seat.seat === battle.activeSeat)!;
    late.timeoutsInRow += 1;
    const events =
      late.timeoutsInRow >= AUTO_SURRENDER_TIMEOUTS
        ? eliminateSeat(battle, late.seat, battleEnv(ctx), "timeout")
        : applyTimeout(battle, battleEnv(ctx));
    return afterBattleStep(state, events);
  }),

  surrender: defineAction(z.object({}), (ctx, state) => {
    const seat = requireSeat(ctx, state);
    if (!isSeat(seat)) return seat;
    const wrongPhase = requirePhase(state, "battle");
    if (wrongPhase) return wrongPhase;
    if (seat.eliminated) return fail("You are already out", "conflict");
    return afterBattleStep(state, eliminateSeat(state.battle!, seat.seat, battleEnv(ctx), "surrender"));
  }),
};

/** Plan §7.4: before the battle the seat is dropped; in battle it is eliminated. */
export function onPlayerRemoved(ctx: Ctx, input: PocketLegionsState, playerId: string): GameTransition<PocketLegionsState> {
  const state = structuredClone(input);
  const seat = seatOf(state, playerId);
  if (!seat || state.phase === "over") return { state: input };

  if (state.phase === "battle") {
    const transition = afterBattleStep(state, eliminateSeat(state.battle!, seat.seat, battleEnv(ctx), "left"));
    return transition.result!;
  }

  state.seats = state.seats.filter((candidate) => candidate !== seat);
  const teamEmpty = ctx.settings.mode === "teams" && [0, 1].some((team) => !state.seats.some((candidate) => candidate.team === team));
  if (state.seats.length < 2 || teamEmpty) {
    state.phase = "over";
    state.result = { winnerSeats: [], reason: "not-enough-players" };
    return { state, finished: true };
  }
  if (state.phase === "army") {
    maybeStartDeploy(state);
  } else {
    // fewer players can mean other deploy zones (corners → columns), so everyone places again
    for (const other of state.seats) {
      other.deployment = null;
      other.deployReady = false;
    }
  }
  return { state };
}

import { getMap } from "../engine/grid";
import type { Rng } from "../engine/rng";
import { skirmoraModule } from "../game/skirmora.module";
import { deployZoneOf } from "../game/skirmora.actions";
import type { SkirmoraView } from "../game/skirmora.projection";
import { Ctx, defaultSettings, SkirmoraSettings, SkirmoraState, Settings } from "../game/skirmora.state";
import type { Result } from "../models/result";
import type { GameTransition } from "../games/gameModule";
import { createSeededRng } from "../utils/random";
import { randomArmy, randomDeployment } from "./fuzz";
import type { ActAction } from "../engine/battle";
import type { HeroPayload } from "../engine/heroes";
import { RACE_IDS } from "../engine/data/races";

export const GAME_START = Date.parse("2026-11-01T12:00:00.000Z");

/** Drives the skirmora module directly through `module.actions`, like the session pipeline does. */
export class GameDriver {
  state: SkirmoraState;
  finished = false;
  now = GAME_START;
  readonly settings: Settings;

  constructor(
    public players: string[],
    settings: Partial<SkirmoraSettings> = {},
    readonly rng: Rng = createSeededRng(1),
    readonly host = players[0]
  ) {
    this.settings = { ...defaultSettings, ...settings, maxPlayers: 4, allowJoinInProgress: false };
    const initial = skirmoraModule.createInitialState(this.ctx(host));
    if (!initial.isSuccess) throw new Error(String(initial.error));
    this.state = initial.result!;
  }

  ctx(actorId: string, activePlayers = this.players): Ctx {
    return {
      actorId,
      hostPlayerId: this.host,
      activePlayers: activePlayers.map((id, i) => ({
        id,
        nickname: id,
        tokenHash: "x",
        joinedAt: new Date(GAME_START + i).toISOString(),
        status: "active",
      })),
      settings: this.settings,
      status: this.finished ? "finished" : "in_progress",
      now: new Date(this.now),
      rng: this.rng,
    };
  }

  /** Runs an action; on success the state moves on, on failure it stays. */
  tryAct(actorId: string, name: string, payload: unknown = {}): Result<GameTransition<SkirmoraState>> {
    const action = skirmoraModule.actions[name];
    const parsed = action.schema.safeParse(payload);
    if (!parsed.success) return { isSuccess: false, error: parsed.error.message, errorStatus: "bad-request" };
    const result = action.handle(this.ctx(actorId), this.state, parsed.data);
    if (result.isSuccess) {
      this.state = result.result!.state;
      this.finished ||= Boolean(result.result!.finished);
    }
    return result;
  }

  act(actorId: string, name: string, payload: unknown = {}): SkirmoraState {
    const result = this.tryAct(actorId, name, payload);
    if (!result.isSuccess) throw new Error(`${name} by ${actorId}: ${result.errorCode ?? result.errorStatus} ${result.errorReason ?? ""} ${result.error}`);
    return this.state;
  }

  view(viewerId: string): SkirmoraView {
    return skirmoraModule.project(this.state, viewerId, this.ctx(viewerId));
  }

  remove(playerId: string): void {
    const remaining = this.players.filter((id) => id !== playerId);
    const transition = skirmoraModule.onPlayerRemoved!(this.ctx(remaining[0] ?? playerId, remaining), this.state, playerId);
    this.players = remaining;
    this.state = transition.state;
    this.finished ||= Boolean(transition.finished);
  }

  playerOfSeat(seat: number): string {
    return this.state.seats.find((candidate) => candidate.seat === seat)!.playerId;
  }

  /** Every seat picks a random race and buys a random legal army. */
  randomArmies(): void {
    for (const seat of this.state.seats) {
      const raceId = this.rng.pick(RACE_IDS);
      this.act(seat.playerId, "pickRace", { raceId });
      const army = randomArmy(this.rng, raceId, {
        budget: this.settings.budget,
        mapSize: getMap(this.settings.mapId).size,
        playerCount: this.state.seats.length,
      });
      this.act(seat.playerId, "submitArmy", army);
    }
  }

  randomDeployments(): void {
    for (const seat of this.state.seats) {
      const zone = deployZoneOf(this.ctx(seat.playerId), this.state, seat);
      const placements = randomDeployment(this.rng, getMap(this.settings.mapId), zone, seat.army!.stacks.length);
      this.act(seat.playerId, "submitDeploy", { placements });
    }
  }

  /** One random legal move for the active player, taken from its hints. Returns false when the game is over. */
  randomTurn(options: { heroChance?: number } = {}): boolean {
    if (this.state.phase !== "battle") return false;
    const player = this.playerOfSeat(this.state.battle!.activeSeat);
    const hints = this.view(player).hints!;
    if (hints.hero && this.rng.int(100) < (options.heroChance ?? 10)) {
      const payload = heroPayloadFromHints(this.rng, hints.hero);
      if (payload) this.act(player, "heroAbility", payload);
      if (this.state.phase !== "battle" || this.state.battle!.activeSeat !== this.state.seats.find((s) => s.playerId === player)!.seat) {
        return this.state.phase === "battle";
      }
    }
    const fresh = this.view(player).hints!;
    this.act(player, "act", this.rng.pick(actionsFromHints(fresh)));
    return this.state.phase === "battle";
  }
}

/** Every `act` payload the hints offer. */
export function actionsFromHints(hints: NonNullable<SkirmoraView["hints"]>): ActAction[] {
  return hints.stacks.flatMap((stack) => [
    ...(stack.canDefend ? [{ stackId: stack.stackId, kind: "defend" as const }] : []),
    ...stack.moves.map((cell) => ({ stackId: stack.stackId, kind: "move" as const, cell })),
    ...stack.attacks.flatMap((attack) => attack.from.map((cell) => ({ stackId: stack.stackId, kind: "attack" as const, target: attack.targetId, cell }))),
    ...stack.shots.map((shot) => ({ stackId: stack.stackId, kind: "shoot" as const, target: shot.targetId })),
    ...stack.abilities.flatMap((ability) =>
      ability.targets.length
        ? ability.targets.map((target) => ({ stackId: stack.stackId, kind: "ability" as const, target }))
        : [{ stackId: stack.stackId, kind: "ability" as const }]
    ),
  ]);
}

function heroPayloadFromHints(rng: Rng, hero: NonNullable<NonNullable<SkirmoraView["hints"]>["hero"]>): HeroPayload | null {
  switch (hero.abilityId) {
    case "battle_cry":
      return {};
    case "hellfire":
      return { cell: rng.pick(hero.cells) };
    case "stone_wall": {
      const free = new Set(hero.cells.map((cell) => `${cell.x},${cell.y}`));
      const start = hero.cells.find((cell) => free.has(`${cell.x + 1},${cell.y}`) && free.has(`${cell.x + 2},${cell.y}`));
      return start ? { cells: [0, 1, 2].map((i) => ({ x: start.x + i, y: start.y })) } : null;
    }
    case "blood_ritual":
      return { target: rng.pick(hero.targets), ally: rng.pick(hero.allies) };
    default:
      return hero.targets.length ? { target: rng.pick(hero.targets) } : null;
  }
}

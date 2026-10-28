import { armyPoints, gearCap, Placement } from "../engine/army";
import type { BattleState, GameEvent, Status } from "../engine/state";
import type { Army, Cell, GameMode, HeroAbilityId, ItemId, MapId, RaceId, UnitId } from "../engine/types";
import { deployZoneOf } from "./skirmora.actions";
import { buildHints, Hints } from "./skirmora.hints";
import { Ctx, GameResult, SkirmoraState, seatOf } from "./skirmora.state";

// Plan §7.5. Whitelist: every field is copied on purpose, so hidden data (other armies and deployments
// before the battle) can't slip through. No time-derived fields — the view only changes with the state (ETag).

export interface SeatView {
  playerId: string;
  seat: number;
  team: 0 | 1 | null;
  raceId: RaceId | null;
  armyReady: boolean;
  deployReady: boolean;
  eliminated: boolean;
}

export interface MyArmyView {
  army: Army | null;
  budget: number;
  gearCap: number;
  unitPoints: number;
  gearPoints: number;
  /** Deploy phase: where your stacks may stand, and where you put them. */
  zone: Cell[] | null;
  deployment: Placement[] | null;
}

export interface StackView {
  id: string;
  seat: number;
  unitId: UnitId;
  count: number;
  hpTop: number;
  startCount: number;
  x: number;
  y: number;
  shots: number;
  retaliationsLeft: number;
  activated: boolean;
  statuses: Status[];
  rage: number;
  resurrectUsed: boolean;
}

export interface BattleView {
  round: number;
  order: number[];
  firstSeat: number;
  activeSeat: number;
  turn: number;
  turnDeadline: string;
  bonusStackId: string | null;
  /** Gear is public once the battle starts. */
  sides: { seat: number; team: 0 | 1 | null; raceId: RaceId; items: ItemId[] }[];
  stacks: StackView[];
  heroes: { seat: number; abilityId: HeroAbilityId; usesLeft: number; readyRound: number; usedThisTurn: boolean }[];
  walls: { x: number; y: number; untilRound: number }[];
}

export interface SkirmoraView {
  phase: SkirmoraState["phase"];
  mapId: MapId;
  mode: GameMode;
  budget: number;
  turnSeconds: number;
  dataVersion: string;
  seats: SeatView[];
  /** Your seat number, or null for a removed player. */
  mySeat: number | null;
  /** Army and deploy phases only. */
  mine: MyArmyView | null;
  battle: BattleView | null;
  /** Only when it's your turn. */
  hints: Hints | null;
  /** The last 64 battle events (plan §3.4). */
  events: GameEvent[];
  result: GameResult | null;
}

function battleView(battle: BattleState): BattleView {
  return {
    round: battle.round,
    order: [...battle.order],
    firstSeat: battle.firstSeat,
    activeSeat: battle.activeSeat,
    turn: battle.turn,
    turnDeadline: battle.turnDeadline,
    bonusStackId: battle.bonusStackId,
    sides: battle.sides.map((side) => ({ seat: side.seat, team: side.team, raceId: side.raceId, items: [...side.items] })),
    stacks: [...battle.stacks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((stack) => ({
        id: stack.id,
        seat: stack.seat,
        unitId: stack.unitId,
        count: stack.count,
        hpTop: stack.hpTop,
        startCount: stack.startCount,
        x: stack.x,
        y: stack.y,
        shots: stack.shots,
        retaliationsLeft: stack.retaliationsLeft,
        activated: stack.activated,
        statuses: stack.statuses.map((status) => ({ ...status })),
        rage: stack.rage,
        resurrectUsed: stack.resurrectUsed,
      })),
    heroes: battle.heroes.map((hero) => ({
      seat: hero.seat,
      abilityId: hero.abilityId,
      usesLeft: hero.usesLeft,
      readyRound: hero.readyRound,
      usedThisTurn: hero.usedThisTurn,
    })),
    walls: battle.walls.map((wall) => ({ x: wall.x, y: wall.y, untilRound: wall.untilRound })),
  };
}

export function project(state: SkirmoraState, viewerId: string, ctx: Pick<Ctx, "settings">): SkirmoraView {
  const me = seatOf(state, viewerId);
  const { settings } = ctx;
  let mine: MyArmyView | null = null;
  if (me && (state.phase === "army" || state.phase === "deploy")) {
    const points = me.army ? armyPoints(me.army, settings.budget) : { unitPoints: 0, gearPoints: 0 };
    mine = {
      army: me.army ? structuredClone(me.army) : null,
      budget: settings.budget,
      gearCap: gearCap(settings.budget),
      ...points,
      zone: state.phase === "deploy" ? deployZoneOf(ctx, state, me) : null,
      deployment: me.deployment ? me.deployment.map((placement) => ({ ...placement })) : null,
    };
  }
  const battle = state.battle;
  return {
    phase: state.phase,
    mapId: settings.mapId,
    mode: settings.mode,
    budget: settings.budget,
    turnSeconds: settings.turnSeconds,
    dataVersion: settings.dataVersion,
    seats: state.seats.map((seat) => ({
      playerId: seat.playerId,
      seat: seat.seat,
      team: seat.team,
      raceId: seat.raceId,
      armyReady: seat.armyReady,
      deployReady: seat.deployReady,
      eliminated: seat.eliminated,
    })),
    mySeat: me ? me.seat : null,
    mine,
    battle: battle ? battleView(battle) : null,
    hints: battle && me && state.phase === "battle" ? buildHints(battle, me.seat) : null,
    events: battle ? battle.events.map((event) => structuredClone(event)) : [],
    result: state.result ? structuredClone(state.result) : null,
  };
}

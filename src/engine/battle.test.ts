import { describe, expect, it } from "vitest";
import { ctxFor, fixedRng, makeBattle, stack, testEnv, TestSide } from "../testing/engine";
import { createSeededRng } from "../utils/random";
import { maxChampions, maxStacks, itemCost, validateArmy, validateDeployment, heroBonuses } from "./army";
import { applyAct, applyHeroAbility, applyTimeout, createBattle, eliminateSeat, stackOptions, turnOrder, zoneFor } from "./battle";
import { damageMultiplier, preview, strike } from "./damage";
import { applyDamage } from "./effects";
import { getMap } from "./grid";
import { lineCells, hasLineOfSight } from "./los";
import { reachable } from "./pathfinding";
import { BattleState, GameEvent, hasStatus } from "./state";
import { defenceOf, attackOf, luckOf, moraleOf } from "./stats";
import { actableStacks } from "./turns";
import { RACES } from "./data/races";

const DWARVES: TestSide[] = [
  { seat: 0, raceId: "dwarves" },
  { seat: 1, raceId: "dwarves" },
];
const village = getMap("village");
const of = (events: GameEvent[], type: GameEvent["type"]) => events.filter((event) => event.type === type);
const cells = (list: { cell: { x: number; y: number } }[]) => list.map((r) => `${r.cell.x},${r.cell.y}`);

function act(battle: BattleState, action: Parameters<typeof applyAct>[2], rng = fixedRng()) {
  const result = applyAct(battle, battle.activeSeat, action, testEnv(rng));
  if (!result.ok) throw new Error(`act failed: ${result.reason}`);
  return result.events;
}

describe("pathfinding (plan §6.2)", () => {
  it("walks 8 directions with diagonal = 1, within speed", () => {
    const b = makeBattle({ sides: DWARVES, stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "miner", count: 1, x: 19, y: 19 }] });
    const reach = reachable(b, village, stack(b, "s0_0"));
    expect(reach).toHaveLength(15); // 4×4 square minus the start
    expect(reach.find((r) => r.cell.x === 3 && r.cell.y === 3)!.cost).toBe(3);
  });

  it("does not cut corners past obstacles", () => {
    // arena: pillar at 3,3; going 2,2 → 3,4? check the diagonal 2,4 → 3,... use a direct corner: from 2,3 to 3,2 crosses no block,
    // but from 2,2 to 3,3 is the pillar. Corner case: 4,2 → 3,... — take 2,3 → 3,4: orthogonals 3,3 (pillar) and 2,4 (rock) → blocked
    const arena = getMap("arena");
    const b = makeBattle({ map: "arena", sides: DWARVES, stacks: [{ seat: 0, unitId: "goblin", count: 1, x: 2, y: 3 }, { seat: 1, unitId: "miner", count: 1, x: 9, y: 9 }] });
    const oneStep = reachable(b, arena, stack(b, "s0_0"), 1);
    // 3,2 and 3,4 are diagonal steps past the pillar at 3,3
    expect(cells(oneStep).sort()).toEqual(["1,2", "1,3", "2,2"]);
  });

  it("passes through allies but not enemies, and never stops on a stack", () => {
    const b = makeBattle({
      sides: DWARVES,
      stacks: [
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 0 },
        { seat: 0, unitId: "miner", count: 1, x: 1, y: 0 },
        { seat: 0, unitId: "miner", count: 1, x: 1, y: 1 },
        { seat: 1, unitId: "miner", count: 1, x: 0, y: 1 },
      ],
    });
    const reach = cells(reachable(b, village, stack(b, "s0_0")));
    expect(reach).toContain("2,0");
    expect(reach).not.toContain("1,0");
    expect(reach).not.toContain("0,1");
    // only through the allies: 0,2 is reachable around the enemy
    expect(reach).toContain("0,2");
  });

  it("flyers land on any free cell within speed", () => {
    const arena = getMap("arena");
    const b = makeBattle({ map: "arena", sides: DWARVES, stacks: [{ seat: 0, unitId: "griffin", count: 1, x: 2, y: 2 }, { seat: 1, unitId: "miner", count: 1, x: 4, y: 4 }] });
    const reach = cells(reachable(b, arena, stack(b, "s0_0")));
    expect(reach).not.toContain("3,3"); // pillar
    expect(reach).not.toContain("4,4"); // stack
    expect(reach).toContain("4,3");
  });

  it("speed bonuses: boots for walkers, sandals for flyers, the wind cloak in round 1", () => {
    const b = makeBattle({
      sides: [{ seat: 0, raceId: "dwarves", items: ["boots_march", "cloak_wind"] }, { seat: 1, raceId: "dwarves", items: ["sandals"] }],
      stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "gyrocopter", count: 1, x: 19, y: 0 }],
    });
    expect(reachable(b, village, stack(b, "s0_0")).at(-1)!.cost).toBe(5);
    expect(reachable(b, village, stack(b, "s1_0")).at(-1)!.cost).toBe(9);
    b.round = 2;
    expect(reachable(b, village, stack(b, "s0_0")).at(-1)!.cost).toBe(4);
  });
});

describe("line of sight (plan §6.3)", () => {
  const arena = getMap("arena");
  it("high obstacles block shots, low ones don't", () => {
    const b = makeBattle({ map: "arena", sides: DWARVES, stacks: [] });
    expect(lineCells({ x: 3, y: 0 }, { x: 3, y: 9 })).toContainEqual({ x: 3, y: 3 });
    expect(hasLineOfSight(b, arena, { x: 3, y: 0 }, { x: 3, y: 9 })).toBe(false); // pillar 3,3
    expect(hasLineOfSight(b, arena, { x: 5, y: 0 }, { x: 5, y: 9 })).toBe(true); // rock 5,2 is low
  });
  it("hero walls block shots and stacks don't", () => {
    const b = makeBattle({ sides: DWARVES, stacks: [{ seat: 0, unitId: "miner", count: 1, x: 2, y: 0 }] });
    expect(hasLineOfSight(b, village, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    b.walls.push({ x: 3, y: 0, untilRound: 3 });
    expect(hasLineOfSight(b, village, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
  });
  it("no shot option without line of sight", () => {
    const b = makeBattle({ map: "arena", sides: DWARVES, stacks: [{ seat: 0, unitId: "dw_xbow", count: 1, x: 3, y: 0 }, { seat: 1, unitId: "miner", count: 1, x: 3, y: 9 }] });
    expect(stackOptions(b, arena, stack(b, "s0_0")).shots).toEqual([]);
  });
});

describe("damage pipeline (plan §6.4)", () => {
  const setup = (sides: TestSide[] = DWARVES, shooterAt = 1) =>
    makeBattle({
      sides,
      stacks: [
        { seat: 0, unitId: "dw_xbow", count: 10, x: 0, y: 0 },
        { seat: 1, unitId: "miner", count: 50, x: shooterAt, y: 0 },
        { seat: 1, unitId: "miner", count: 50, x: 10, y: 0 },
      ],
    });
  const hitOf = (b: BattleState, target: string, mode: "melee" | "ranged") => ({
    attacker: stack(b, "s0_0"),
    target: stack(b, target),
    mode,
    retaliation: false,
    moved: 0,
    factor: 1,
    splash: false,
    magic: false,
  });

  it("range penalty beyond range, adjacency penalty with an enemy next to the shooter", () => {
    const near = setup(DWARVES, 5);
    // s1_1 at 10 is beyond range 6
    expect(damageMultiplier(near, hitOf(near, "s1_1", "ranged")) / damageMultiplier(near, hitOf(near, "s1_0", "ranged"))).toBeCloseTo(0.5);
    const adjacent = setup(DWARVES, 1);
    expect(damageMultiplier(adjacent, hitOf(adjacent, "s1_1", "ranged")) / damageMultiplier(near, hitOf(near, "s1_1", "ranged"))).toBeCloseTo(0.5);
    // a shooter in melee also has −50%
    expect(damageMultiplier(adjacent, hitOf(adjacent, "s1_0", "melee"))).toBeCloseTo(damageMultiplier(adjacent, hitOf(adjacent, "s1_0", "ranged")));
  });

  it("luck: 5% per point, ×2 on positive and ×0.5 on negative, demons never negative", () => {
    const lucky = makeBattle({
      sides: [{ seat: 0, raceId: "dwarves", items: ["clover"] }, { seat: 1, raceId: "dwarves" }],
      stacks: [{ seat: 0, unitId: "miner", count: 10, x: 0, y: 0 }, { seat: 1, unitId: "golem", count: 10, x: 1, y: 0 }],
    });
    const ctx = ctxFor(lucky, testEnv(fixedRng({ chance: true })));
    const base = preview(lucky, { attacker: stack(lucky, "s0_0"), target: stack(lucky, "s1_0"), mode: "melee", moved: 0, retaliation: false }).dmg[0];
    const dealt = strike(ctx, hitOf(lucky, "s1_0", "melee") as never);
    expect(of(ctx.out, "luck")[0].detail).toBe("double");
    expect(dealt).toBeGreaterThanOrEqual(base * 2 - 1);

    const demons = makeBattle({ sides: [{ seat: 0, raceId: "demons", items: ["axe_bers"] }, { seat: 1, raceId: "dwarves" }], stacks: [{ seat: 0, unitId: "imp", count: 1, x: 0, y: 0 }] });
    expect(luckOf(demons, stack(demons, "s0_0"))).toBe(2);
    expect(luckOf(makeBattle({ sides: [{ seat: 0, raceId: "elves" }], stacks: [{ seat: 0, unitId: "elf_archer", count: 1, x: 0, y: 0 }] }), { seat: 0, unitId: "elf_archer" } as never)).toBe(2);
  });

  it("caps luck and morale at +5", () => {
    expect(heroBonuses("elves", ["clover", "helm_luck", "ring_luck", "ring_luck", "spear_1000"]).luck).toBe(5);
    expect(heroBonuses("knights", ["crown", "amu_valor"]).morale).toBe(3);
  });

  it("knight formation +2 defence next to an ally, barbarian fury +1 attack per lost unit up to +4", () => {
    const b = makeBattle({
      sides: [{ seat: 0, raceId: "knights" }, { seat: 1, raceId: "barbarians" }],
      stacks: [
        { seat: 0, unitId: "swordsman", count: 5, x: 0, y: 0 },
        { seat: 0, unitId: "swordsman", count: 5, x: 1, y: 0 },
        { seat: 0, unitId: "swordsman", count: 5, x: 5, y: 0 },
        { seat: 1, unitId: "orc", count: 10, x: 10, y: 0 },
      ],
    });
    expect(defenceOf(b, stack(b, "s0_0")) - defenceOf(b, stack(b, "s0_2"))).toBe(2);
    const orc = stack(b, "s1_0");
    const fresh = attackOf(b, orc);
    orc.count = 8;
    expect(attackOf(b, orc)).toBe(fresh + 2);
    orc.count = 1;
    expect(attackOf(b, orc)).toBe(fresh + 4);
  });

  it("defend: +30% defence, +50% for dwarves, until the next activation", () => {
    const b = makeBattle({
      sides: [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: "knights" }],
      stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "militia", count: 1, x: 5, y: 5 }],
    });
    const miner = stack(b, "s0_0");
    const before = defenceOf(b, miner);
    act(b, { stackId: "s0_0", kind: "defend" });
    expect(defenceOf(b, miner)).toBeCloseTo(before * 1.5);
    act(b, { stackId: "s1_0", kind: "defend" });
    expect(defenceOf(b, stack(b, "s1_0"))).toBeCloseTo((3 + 3) * 1.3);
    // round 2 (seat 1 opens it): the miner's next activation clears it
    act(b, { stackId: "s1_0", kind: "defend" });
    act(b, { stackId: "s0_0", kind: "move", cell: { x: 1, y: 0 } });
    expect(hasStatus(miner, "defending")).toBe(false);
  });

  it("damage takes the top unit first and kills whole units", () => {
    const b = makeBattle({ sides: DWARVES, stacks: [{ seat: 0, unitId: "miner", count: 5, x: 0, y: 0, with: { hpTop: 3 } }] });
    const ctx = ctxFor(b);
    expect(applyDamage(ctx, stack(b, "s0_0"), 11)).toEqual({ dealt: 11, kills: 2 });
    expect(stack(b, "s0_0")).toMatchObject({ count: 3, hpTop: 8 });
    expect(applyDamage(ctx, stack(b, "s0_0"), 100)).toEqual({ dealt: 24, kills: 3 });
    expect(of(ctx.out, "stackDied")).toHaveLength(1);
  });
});

describe("turns (plan §6.5)", () => {
  it("alternates one stack per turn, skips a seat with nothing left, rotates the first seat", () => {
    const b = makeBattle({
      sides: DWARVES,
      stacks: [
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 0 },
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 1 },
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 2 },
        { seat: 1, unitId: "miner", count: 1, x: 19, y: 0 },
      ],
    });
    const seats: number[] = [];
    const turn = (id: string) => {
      seats.push(b.activeSeat);
      act(b, { stackId: id, kind: "defend" });
    };
    turn("s0_0");
    turn("s1_0");
    turn("s0_1");
    turn("s0_2");
    expect(seats).toEqual([0, 1, 0, 0]);
    expect(b.round).toBe(2);
    expect(b.firstSeat).toBe(1);
    expect(b.activeSeat).toBe(1);
  });

  it("rejects acting out of turn, with a stack that already acted, or another seat's stack", () => {
    const b = makeBattle({ sides: DWARVES, stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 0, unitId: "miner", count: 1, x: 0, y: 2 }, { seat: 1, unitId: "miner", count: 1, x: 19, y: 0 }] });
    expect(applyAct(b, 1, { stackId: "s1_0", kind: "defend" }, testEnv())).toMatchObject({ ok: false, code: "not-your-turn" });
    expect(applyAct(b, 0, { stackId: "s1_0", kind: "defend" }, testEnv())).toMatchObject({ ok: false, code: "illegal-action" });
    act(b, { stackId: "s0_0", kind: "defend" });
    act(b, { stackId: "s1_0", kind: "defend" });
    expect(applyAct(b, 0, { stackId: "s0_0", kind: "defend" }, testEnv())).toMatchObject({ ok: false, reason: "stack-cannot-act" });
  });

  it("orders 2 vs 2 so the teams alternate, and puts allies in the corners of one side", () => {
    const sides = [
      { seat: 0, team: 0 as const },
      { seat: 1, team: 0 as const },
      { seat: 2, team: 1 as const },
      { seat: 3, team: 1 as const },
    ];
    expect(turnOrder("teams", sides)).toEqual([0, 2, 1, 3]);
    expect(turnOrder("ffa", sides)).toEqual([0, 1, 2, 3]);
    const map = getMap("graveyard");
    expect(zoneFor(map, "teams", sides, 1)[0]).toEqual({ x: 0, y: 12 });
    expect(zoneFor(map, "teams", sides, 2)[0]).toEqual({ x: 12, y: 0 });
    expect(zoneFor(map, "ffa", sides.slice(0, 2), 1)[0]).toEqual({ x: 14, y: 0 });
  });

  it("positive morale: the stack acts again; negative morale: it loses the activation", () => {
    const happy = makeBattle({
      sides: [{ seat: 0, raceId: "knights" }, { seat: 1, raceId: "dwarves" }],
      stacks: [{ seat: 0, unitId: "militia", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "miner", count: 1, x: 19, y: 0 }],
    });
    const events = act(happy, { stackId: "s0_0", kind: "move", cell: { x: 1, y: 0 } }, fixedRng({ chance: true }));
    expect(of(events, "morale")[0].detail).toBe("again");
    expect(happy.activeSeat).toBe(0);
    expect(actableStacks(happy).map((s) => s.id)).toEqual(["s0_0"]);
    act(happy, { stackId: "s0_0", kind: "move", cell: { x: 2, y: 0 } }, fixedRng({ chance: true }));
    expect(happy.activeSeat).toBe(1); // no second bonus in a row

    // no hero or item gives negative morale today, so lower the dwarf hero for this check
    const hero = RACES.dwarves.hero;
    hero.morale = -2;
    try {
      const sad = makeBattle({ sides: DWARVES, stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "miner", count: 1, x: 19, y: 0 }] });
      expect(moraleOf(sad, stack(sad, "s0_0"))).toBe(-2);
      const lost = act(sad, { stackId: "s0_0", kind: "move", cell: { x: 1, y: 0 } }, fixedRng({ chance: true }));
      expect(of(lost, "morale")[0].detail).toBe("skip");
      expect(of(lost, "moved")).toEqual([]);
      expect(sad.activeSeat).toBe(1);
    } finally {
      hero.morale = 0;
    }
  });

  it("undead and mechanisms always have morale 0", () => {
    const b = makeBattle({
      sides: [{ seat: 0, raceId: "vampires", items: ["amu_valor"] }, { seat: 1, raceId: "dwarves", items: ["amu_valor"] }],
      stacks: [{ seat: 0, unitId: "skeleton", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "golem", count: 1, x: 5, y: 0 }, { seat: 1, unitId: "miner", count: 1, x: 6, y: 0 }],
    });
    expect(moraleOf(b, stack(b, "s0_0"))).toBe(0);
    expect(moraleOf(b, stack(b, "s1_0"))).toBe(0);
    expect(moraleOf(b, stack(b, "s1_1"))).toBe(1);
  });

  it("retaliation once per round, twice with the guard shield, refreshed every round", () => {
    const setup = (items: TestSide["items"]) =>
      makeBattle({
        sides: [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: "dwarves", items }],
        stacks: [
          { seat: 0, unitId: "miner", count: 1, x: 0, y: 0 },
          { seat: 0, unitId: "miner", count: 1, x: 2, y: 0 },
          { seat: 0, unitId: "miner", count: 1, x: 0, y: 1 },
          { seat: 1, unitId: "shieldbearer", count: 20, x: 1, y: 0 },
          { seat: 1, unitId: "miner", count: 1, x: 19, y: 19 },
          { seat: 1, unitId: "miner", count: 1, x: 19, y: 18 },
        ],
      });
    const run = (b: BattleState) => {
      const events = [...act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" })];
      act(b, { stackId: "s1_1", kind: "defend" });
      events.push(...act(b, { stackId: "s0_1", kind: "attack", target: "s1_0" }));
      act(b, { stackId: "s1_2", kind: "defend" });
      events.push(...act(b, { stackId: "s0_2", kind: "attack", target: "s1_0" }));
      return of(events, "retaliated").length;
    };
    expect(run(setup([]))).toBe(1);
    expect(run(setup(["shield_guard"]))).toBe(2);
  });

  it("vampire necromancy: 15% of the enemy HP killed this round joins the skeletons", () => {
    const b = makeBattle({
      sides: [{ seat: 0, raceId: "vampires" }, { seat: 1, raceId: "dwarves" }],
      stacks: [
        { seat: 0, unitId: "skeleton", count: 10, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 19, y: 19, with: { activated: true } },
      ],
    });
    b.killedThisRound.push({ seat: 1, hp: 200 }, { seat: 0, hp: 600 });
    const events = act(b, { stackId: "s0_0", kind: "defend" });
    expect(of(events, "raised")[0].amount).toBe(5); // 15% of 200 = 30 HP = 5 skeletons
    expect(stack(b, "s0_0").count).toBe(15);
  });

  it("claimTimeout: the first stack that hasn't acted defends and the turn passes", () => {
    const b = makeBattle({ sides: DWARVES, stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 0, unitId: "miner", count: 1, x: 0, y: 2 }, { seat: 1, unitId: "miner", count: 1, x: 19, y: 0 }] });
    const events = applyTimeout(b, testEnv());
    expect(of(events, "timedOut")).toHaveLength(1);
    expect(hasStatus(stack(b, "s0_0"), "defending")).toBe(true);
    expect(b.activeSeat).toBe(1);
  });

  it("surrender removes the stacks and can end the battle", () => {
    const b = makeBattle({
      sides: [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: "dwarves" }, { seat: 2, raceId: "dwarves" }],
      stacks: [{ seat: 0, unitId: "miner", count: 1, x: 0, y: 0 }, { seat: 1, unitId: "miner", count: 1, x: 19, y: 0 }, { seat: 2, unitId: "miner", count: 1, x: 19, y: 19 }],
    });
    eliminateSeat(b, 0, testEnv(), "surrender");
    expect(stack(b, "s0_0").count).toBe(0);
    expect(b.activeSeat).toBe(1);
    expect(b.result).toBeNull();
    const events = eliminateSeat(b, 2, testEnv(), "surrender");
    expect(b.result).toEqual({ winnerSeats: [1], reason: "surrender" });
    expect(of(events, "battleOver")).toHaveLength(1);
  });

  it("ends after round 30 on points of living army; ties stay ties", () => {
    const b = makeBattle({
      round: 30,
      sides: DWARVES,
      stacks: [{ seat: 0, unitId: "miner", count: 4, x: 0, y: 0 }, { seat: 1, unitId: "golem", count: 1, x: 19, y: 0, with: { activated: true } }],
    });
    act(b, { stackId: "s0_0", kind: "defend" });
    expect(b.result).toEqual({ winnerSeats: [1], reason: "round-limit", points: [100, 265] });

    const tie = makeBattle({
      round: 30,
      sides: DWARVES,
      stacks: [{ seat: 0, unitId: "miner", count: 2, x: 0, y: 0 }, { seat: 1, unitId: "miner", count: 2, x: 19, y: 0, with: { activated: true } }],
    });
    act(tie, { stackId: "s0_0", kind: "defend" });
    expect(tie.result).toMatchObject({ winnerSeats: [0, 1], reason: "round-limit" });
  });

  it("2 vs 2: the last team wins, both seats", () => {
    const b = makeBattle({
      mode: "teams",
      sides: [
        { seat: 0, raceId: "dwarves", team: 0 },
        { seat: 1, raceId: "dwarves", team: 1 },
        { seat: 2, raceId: "dwarves", team: 0 },
        { seat: 3, raceId: "dwarves", team: 1 },
      ],
      stacks: [
        { seat: 0, unitId: "titan", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 0 },
        { seat: 2, unitId: "miner", count: 1, x: 19, y: 19 },
        { seat: 3, unitId: "miner", count: 1, x: 10, y: 10, with: { count: 0 } },
      ],
    });
    b.sides[3].eliminated = true;
    act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
    expect(b.result).toEqual({ winnerSeats: [0, 2], reason: "elimination" });
  });
});

describe("hero abilities", () => {
  const heroBattle = (raceId: TestSide["raceId"], items: TestSide["items"] = []) =>
    makeBattle({
      sides: [{ seat: 0, raceId, items }, { seat: 1, raceId: "knights" }],
      stacks: [
        { seat: 0, unitId: "miner", count: 10, x: 0, y: 0, with: { hpTop: 2 } },
        { seat: 1, unitId: "militia", count: 20, x: 5, y: 1 },
        { seat: 1, unitId: "militia", count: 20, x: 6, y: 1 },
      ],
    });
  const use = (b: BattleState, payload: Parameters<typeof applyHeroAbility>[2]) => {
    const result = applyHeroAbility(b, 0, payload, testEnv());
    if (!result.ok) throw new Error(result.reason);
    return result.events;
  };

  it("heavenly shield: −50% damage taken until the end of the round", () => {
    const b = heroBattle("knights");
    use(b, { target: "s0_0" });
    expect(hasStatus(stack(b, "s0_0"), "heavenly_shield")).toBe(true);
  });

  it("blood ritual: 25 damage ignoring defence and 25 HP healed", () => {
    const b = heroBattle("vampires");
    const events = use(b, { target: "s1_0", ally: "s0_0" });
    expect(of(events, "damaged")[0]).toMatchObject({ stackId: "s1_0", amount: 25 });
    expect(stack(b, "s0_0").hpTop).toBe(8);
  });

  it("battle cry: +25% damage for all your stacks this round", () => {
    const b = heroBattle("barbarians");
    const before = damageMultiplier(b, { attacker: stack(b, "s0_0"), target: stack(b, "s1_0"), mode: "melee", retaliation: false, moved: 0, factor: 1, splash: false, magic: false });
    use(b, {});
    const after = damageMultiplier(b, { attacker: stack(b, "s0_0"), target: stack(b, "s1_0"), mode: "melee", retaliation: false, moved: 0, factor: 1, splash: false, magic: false });
    expect(after / before).toBeCloseTo(1.25);
  });

  it("earth roots: 15 damage and no movement until its next activation", () => {
    const b = heroBattle("elves");
    use(b, { target: "s1_0" });
    expect(hasStatus(stack(b, "s1_0"), "entangled")).toBe(true);
  });

  it("stone wall: 3 free cells in a line for 3 rounds, blocking movement", () => {
    const b = heroBattle("dwarves");
    expect(applyHeroAbility(b, 0, { cells: [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 3 }] }, testEnv())).toMatchObject({ ok: false });
    use(b, { cells: [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }] });
    expect(b.walls.map((wall) => wall.untilRound)).toEqual([3, 3, 3]);
    expect(cells(reachable(b, village, stack(b, "s0_0")))).not.toContain("2,1");
  });

  it("hellfire: 20 to every stack in the 3×3 square, own included; dwarves take −25%", () => {
    const b = heroBattle("demons");
    stack(b, "s0_0").x = 4;
    stack(b, "s0_0").y = 0;
    b.sides[1].raceId = "dwarves";
    const events = use(b, { cell: { x: 5, y: 1 } });
    expect(of(events, "damaged").map((e) => [e.stackId, e.amount])).toEqual([
      ["s0_0", 20],
      ["s1_0", 15],
      ["s1_1", 15],
    ]);
  });

  it("2 uses per battle, 3-round cooldown, one per turn; the mantle adds a use and +50% power", () => {
    const b = heroBattle("vampires", ["mantle"]);
    use(b, { target: "s1_0", ally: "s0_0" });
    expect(applyHeroAbility(b, 0, { target: "s1_0", ally: "s0_0" }, testEnv())).toMatchObject({ ok: false, reason: "hero-unavailable" });
    expect(b.heroes[0]).toMatchObject({ usesLeft: 2, readyRound: 4 });
    expect(of(b.events, "damaged")[0].amount).toBe(37);
    const elsewhere = heroBattle("vampires");
    expect(applyHeroAbility(elsewhere, 1, {}, testEnv())).toMatchObject({ ok: false, code: "not-your-turn" });
  });
});

describe("armies (plan §6.7)", () => {
  const rules = { budget: 1000, mapSize: 14, playerCount: 2 };
  const army = (stacks: { unitId: string; count: number }[], items = {}, rings: string[] = []) => ({ stacks, items, rings }) as never;

  it("accepts the design doc's example army", () => {
    const check = validateArmy(
      army(
        [{ unitId: "angel", count: 1 }, { unitId: "swordsman", count: 6 }, { unitId: "archer", count: 4 }],
        { head: "helm_luck", body: "chainmail", neck: "amu_valor" },
        ["ring_str"]
      ),
      "knights",
      rules
    );
    expect(check).toEqual({ ok: true, unitPoints: 855, gearPoints: 130 });
  });

  it("names each failed rule", () => {
    const cases: [unknown, string][] = [
      [army([]), "no-stacks"],
      [army(Array.from({ length: 7 }, () => ({ unitId: "militia", count: 1 }))), "too-many-stacks"],
      [army([{ unitId: "nope", count: 1 }]), "unknown-unit"],
      [army([{ unitId: "goblin", count: 1 }]), "wrong-race"],
      [army([{ unitId: "militia", count: 0 }]), "bad-count"],
      [army([{ unitId: "militia", count: 1 }, { unitId: "militia", count: 1 }, { unitId: "militia", count: 1 }]), "too-many-of-type"],
      [army([{ unitId: "angel", count: 3 }]), "too-many-champions"],
      [army([{ unitId: "militia", count: 1 }], { head: "nope" }), "unknown-item"],
      [army([{ unitId: "militia", count: 1 }], { head: "plate" }), "wrong-slot"],
      [army([{ unitId: "militia", count: 1 }], {}, ["ring_str", "ring_def", "ring_luck"]), "too-many-rings"],
      [army([{ unitId: "militia", count: 1 }], { head: "crown", neck: "dragon_eye", body: "plate", weapon: "spear_1000", shield: "shield_guard" }), "gear-over-cap"],
      [army([{ unitId: "militia", count: 41 }]), "over-budget"],
    ];
    for (const [input, reason] of cases) {
      expect({ reason, got: validateArmy(input as never, "knights", rules) }).toEqual({ reason, got: { ok: false, reason } });
    }
  });

  it("scales gear prices and the champion cap with the budget; 5 stacks on a crowded arena", () => {
    expect(itemCost("plate", 500)).toBe(38);
    expect(itemCost("plate", 2000)).toBe(150);
    expect([500, 1000, 1500, 2000].map(maxChampions)).toEqual([1, 2, 3, 4]);
    expect(maxStacks(10, 3)).toBe(5);
    expect(maxStacks(10, 2)).toBe(6);
    expect(maxStacks(12, 4)).toBe(6);
  });

  it("validates deployments", () => {
    const arena = getMap("arena");
    const zone = zoneFor(arena, "ffa", [{ seat: 0, team: null }, { seat: 1, team: null }], 0);
    expect(validateDeployment(arena, zone, 2, [{ stackIndex: 0, x: 0, y: 0 }, { stackIndex: 1, x: 1, y: 0 }])).toEqual({ ok: true });
    expect(validateDeployment(arena, zone, 2, [{ stackIndex: 0, x: 0, y: 0 }])).toEqual({ ok: false, reason: "missing-stack" });
    expect(validateDeployment(arena, zone, 2, [{ stackIndex: 0, x: 0, y: 0 }, { stackIndex: 0, x: 1, y: 0 }])).toEqual({ ok: false, reason: "duplicate-stack" });
    expect(validateDeployment(arena, zone, 1, [{ stackIndex: 0, x: 5, y: 0 }])).toEqual({ ok: false, reason: "outside-zone" });
    expect(validateDeployment(arena, zone, 2, [{ stackIndex: 0, x: 0, y: 0 }, { stackIndex: 1, x: 0, y: 0 }])).toEqual({ ok: false, reason: "cell-taken" });
  });
});

describe("createBattle", () => {
  it("places the stacks, picks a random first seat and starts its turn", () => {
    const { battle, events } = createBattle(
      {
        mapId: "arena",
        mode: "ffa",
        sides: [
          { seat: 0, team: null, raceId: "elves", army: { stacks: [{ unitId: "marksman", count: 3 }], items: {}, rings: ["ring_sniper"] }, deployment: [{ stackIndex: 0, x: 0, y: 4 }] },
          { seat: 1, team: null, raceId: "knights", army: { stacks: [{ unitId: "militia", count: 10 }], items: { cloak: "mantle" }, rings: [] }, deployment: [{ stackIndex: 0, x: 9, y: 4 }] },
        ],
      },
      testEnv(createSeededRng(7))
    );
    expect(battle.stacks.map((s) => [s.id, s.x, s.y, s.count, s.shots])).toEqual([
      ["s0_0", 0, 4, 3, 13],
      ["s1_0", 9, 4, 10, 0],
    ]);
    expect(battle.heroes.map((h) => h.usesLeft)).toEqual([2, 3]);
    expect(events.map((e) => e.type)).toEqual(["battleStarted", "roundStarted", "turnStarted"]);
    expect(battle.turnDeadline).toBe("2026-11-01T12:00:45.000Z");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

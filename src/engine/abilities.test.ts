import { describe, expect, it } from "vitest";
import { ctxFor, fixedRng, makeBattle, stack, testEnv, TestSide, TestStack, withAbilities } from "../testing/engine";
import { ABILITY_IDS } from "./abilities";
import { applyAct, applyHeroAbility, stackOptions } from "./battle";
import { damageMultiplier, preview, strike } from "./damage";
import { kad } from "./balance";
import { getMap } from "./grid";
import { heroOptions } from "./heroes";
import { reachable } from "./pathfinding";
import { BattleState, GameEvent, hasStatus } from "./state";
import { attackOf, defenceOf, speedOf } from "./stats";

// Plan §6.6: every ability has a test that shows the effect and one that shows it doesn't fire when it shouldn't.
// Both sides are dwarves unless a test needs a race trait: dwarves have luck 0 and morale 0, so fixed rolls stay fixed.

const DWARVES: TestSide[] = [
  { seat: 0, raceId: "dwarves" },
  { seat: 1, raceId: "dwarves" },
];
const map = getMap("village");

function battleOf(stacks: TestStack[], sides: TestSide[] = DWARVES, extra: Partial<Parameters<typeof makeBattle>[0]> = {}) {
  return makeBattle({ sides, stacks, ...extra });
}

function act(battle: BattleState, action: Parameters<typeof applyAct>[2], rng = fixedRng()) {
  const result = applyAct(battle, battle.activeSeat, action, testEnv(rng));
  if (!result.ok) throw new Error(`act failed: ${result.reason}`);
  return result.events;
}

const of = (events: GameEvent[], type: GameEvent["type"]) => events.filter((event) => event.type === type);
const damageTo = (events: GameEvent[], id: string) => of(events, "damaged").filter((event) => event.stackId === id);
/** The deterministic damage multiplier (steps 3–6) of one hit. */
const mult = (battle: BattleState, a: string, t: string, mode: "melee" | "ranged" = "melee", moved = 0, retaliation = false) =>
  damageMultiplier(battle, { attacker: stack(battle, a), target: stack(battle, t), mode, moved, retaliation, factor: 1, splash: false, magic: mode === "ranged" && stack(battle, a).unitId === "druid" });
const minDamage = (battle: BattleState, a: string, t: string, mode: "melee" | "ranged" = "melee", moved = 0, retaliation = false) =>
  preview(battle, { attacker: stack(battle, a), target: stack(battle, t), mode, moved, retaliation }).dmg[0];

describe("abilities", () => {
  it("has a hook entry for each of the 39 abilities", () => {
    expect(ABILITY_IDS).toHaveLength(39);
  });

  describe("shield / bone: −50% from shots", () => {
    for (const [unitId, ability] of [["swordsman", "shield"], ["skeleton", "bone"]] as const) {
      it(`${ability} halves shots`, () => {
        const b = battleOf([
          { seat: 0, unitId: "archer", count: 20, x: 0, y: 0 },
          { seat: 1, unitId, count: 20, x: 5, y: 0 },
        ]);
        const withIt = minDamage(b, "s0_0", "s1_0", "ranged");
        const without = withAbilities(unitId, [], () => minDamage(b, "s0_0", "s1_0", "ranged"));
        expect(withIt).toBe(Math.floor(without / 2));
      });
      it(`${ability} does not reduce melee`, () => {
        const b = battleOf([
          { seat: 0, unitId: "militia", count: 20, x: 0, y: 0 },
          { seat: 1, unitId, count: 20, x: 1, y: 0 },
        ]);
        expect(minDamage(b, "s0_0", "s1_0")).toBe(withAbilities(unitId, [], () => minDamage(b, "s0_0", "s1_0")));
      });
    }
  });

  describe("no_retal", () => {
    it("the target does not retaliate", () => {
      const b = battleOf([
        { seat: 0, unitId: "bat", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "militia", count: 5, x: 2, y: 0 },
      ]);
      expect(of(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0", cell: { x: 1, y: 0 } }), "retaliated")).toEqual([]);
    });
    it("a unit without it gets retaliation", () => {
      const b = battleOf([
        { seat: 0, unitId: "horned", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "militia", count: 5, x: 1, y: 0 },
      ]);
      expect(of(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "retaliated")).toHaveLength(1);
    });
  });

  describe("unlim_retal", () => {
    const setup = (defender: "griffin" | "militia") =>
      battleOf([
        { seat: 0, unitId: "goblin", count: 1, x: 0, y: 0 },
        { seat: 0, unitId: "goblin", count: 1, x: 2, y: 0 },
        { seat: 1, unitId: defender, count: 30, x: 1, y: 0 },
        { seat: 1, unitId: "militia", count: 1, x: 19, y: 19 },
      ]);
    const attackTwice = (b: BattleState) => {
      const first = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      act(b, { stackId: "s1_1", kind: "defend" });
      return [...first, ...act(b, { stackId: "s0_1", kind: "attack", target: "s1_0" })];
    };
    it("retaliates against every hit", () => {
      expect(of(attackTwice(setup("griffin")), "retaliated")).toHaveLength(2);
    });
    it("others retaliate once per round", () => {
      expect(of(attackTwice(setup("militia")), "retaliated")).toHaveLength(1);
    });
  });

  describe("double_strike", () => {
    it("hits twice with the retaliation in between", () => {
      const b = battleOf([
        { seat: 0, unitId: "fencer", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 1, y: 0 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(of(events, "damaged").map((event) => event.stackId)).toEqual(["s1_0", "s0_0", "s1_0"]);
    });
    it("a single-hit unit hits once", () => {
      const b = battleOf([
        { seat: 0, unitId: "orc", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 1, y: 0 },
      ]);
      expect(damageTo(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "s1_0")).toHaveLength(1);
    });
  });

  describe("double_shot", () => {
    it("shoots twice for one shot", () => {
      const b = battleOf([
        { seat: 0, unitId: "marksman", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 0 },
      ]);
      const before = stack(b, "s0_0").shots;
      expect(damageTo(act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" }), "s1_0")).toHaveLength(2);
      expect(stack(b, "s0_0").shots).toBe(before - 1);
    });
    it("other shooters shoot once", () => {
      const b = battleOf([
        { seat: 0, unitId: "elf_archer", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 0 },
      ]);
      expect(damageTo(act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" }), "s1_0")).toHaveLength(1);
    });
  });

  describe("charge", () => {
    const b = battleOf([
      { seat: 0, unitId: "knight", count: 10, x: 0, y: 0 },
      { seat: 1, unitId: "golem", count: 10, x: 7, y: 0 },
    ]);
    it("+6% per cell moved, up to +36%", () => {
      const still = mult(b, "s0_0", "s1_0", "melee", 0);
      expect(mult(b, "s0_0", "s1_0", "melee", 5) / still).toBeCloseTo(1.3);
      expect(mult(b, "s0_0", "s1_0", "melee", 9) / still).toBeCloseTo(1.36);
    });
    it("no bonus on retaliation", () => {
      expect(mult(b, "s0_0", "s1_0", "melee", 5, true)).toBe(mult(b, "s0_0", "s1_0", "melee", 0));
    });
  });

  describe("piercing", () => {
    it("ignores 40% of the defence", () => {
      const b = battleOf([
        { seat: 0, unitId: "crossbowman", count: 10, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 5, y: 0 },
      ]);
      expect(minDamage(b, "s0_0", "s1_0", "ranged")).toBeGreaterThan(
        withAbilities("crossbowman", [], () => minDamage(b, "s0_0", "s1_0", "ranged"))
      );
    });
    it("changes nothing against zero defence", () => {
      const b = battleOf([
        { seat: 0, unitId: "crossbowman", count: 10, x: 0, y: 0 },
        { seat: 1, unitId: "goblin", count: 10, x: 5, y: 0, with: { statuses: [] } },
      ]);
      // a goblin with -1 gear defence: hero 4 + 1 - 5 (sword of berserker on a 0-def side) is awkward; use defence 0 directly
      const target = stack(b, "s1_0");
      b.sides[1].raceId = "barbarians";
      b.sides[1].items = ["axe_bers"];
      expect(defenceOf(b, target)).toBe(0);
      expect(minDamage(b, "s0_0", "s1_0", "ranged")).toBe(withAbilities("crossbowman", [], () => minDamage(b, "s0_0", "s1_0", "ranged")));
    });
  });

  describe("heal", () => {
    it("heals the top unit of an ally in radius 3, without reviving", () => {
      const b = battleOf([
        { seat: 0, unitId: "monk", count: 5, x: 0, y: 0 },
        { seat: 0, unitId: "paladin", count: 3, x: 3, y: 0, with: { hpTop: 10, startCount: 5 } },
        { seat: 1, unitId: "militia", count: 1, x: 19, y: 19 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "ability", target: "s0_1" });
      expect(of(events, "healed")[0]).toMatchObject({ stackId: "s0_1", amount: 20 });
      expect(stack(b, "s0_1")).toMatchObject({ count: 3, hpTop: 30 });
    });
    it("can't target an unwounded ally or one out of range", () => {
      const b = battleOf([
        { seat: 0, unitId: "monk", count: 5, x: 0, y: 0 },
        { seat: 0, unitId: "paladin", count: 3, x: 3, y: 0 },
        { seat: 0, unitId: "paladin", count: 3, x: 4, y: 0, with: { hpTop: 1 } },
        { seat: 1, unitId: "militia", count: 1, x: 19, y: 19 },
      ]);
      expect(applyAct(b, 0, { stackId: "s0_0", kind: "ability", target: "s0_1" }, testEnv())).toMatchObject({ ok: false });
      expect(applyAct(b, 0, { stackId: "s0_0", kind: "ability", target: "s0_2" }, testEnv())).toMatchObject({ ok: false });
    });
  });

  describe("holy", () => {
    const setup = (race: TestSide["raceId"]) =>
      battleOf(
        [
          { seat: 0, unitId: "paladin", count: 5, x: 0, y: 0 },
          { seat: 1, unitId: "golem", count: 5, x: 1, y: 0 },
        ],
        [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: race }]
      );
    it("+50% against undead and demons", () => {
      for (const race of ["vampires", "demons"] as const) {
        const b = setup(race);
        const base = withAbilities("paladin", [], () => mult(b, "s0_0", "s1_0"));
        expect(mult(b, "s0_0", "s1_0") / base).toBeCloseTo(1.5);
      }
    });
    it("no bonus against the living", () => {
      const b = setup("knights");
      expect(minDamage(b, "s0_0", "s1_0")).toBe(withAbilities("paladin", [], () => minDamage(b, "s0_0", "s1_0")));
    });
  });

  describe("resurrect", () => {
    const setup = () =>
      battleOf([
        { seat: 0, unitId: "angel", count: 2, x: 0, y: 0 },
        { seat: 0, unitId: "militia", count: 2, x: 15, y: 0, with: { startCount: 20, hpTop: 3 } },
        { seat: 1, unitId: "militia", count: 1, x: 19, y: 19 },
      ]);
    it("revives up to 40 HP per angel, anywhere, up to the starting count", () => {
      const b = setup();
      act(b, { stackId: "s0_0", kind: "ability", target: "s0_1" });
      // 7 + 3 HP left, +80 → 90 HP → 13 units (12×7 + 6)
      expect(stack(b, "s0_1")).toMatchObject({ count: 13, hpTop: 6 });
      expect(stack(b, "s0_0").resurrectUsed).toBe(true);
    });
    it("only once per battle, and never past the starting count", () => {
      const b = setup();
      stack(b, "s0_0").resurrectUsed = true;
      expect(applyAct(b, 0, { stackId: "s0_0", kind: "ability", target: "s0_1" }, testEnv())).toMatchObject({ ok: false });
      const full = setup();
      stack(full, "s0_1").startCount = 2;
      stack(full, "s0_1").hpTop = 7;
      expect(applyAct(full, 0, { stackId: "s0_0", kind: "ability", target: "s0_1" }, testEnv())).toMatchObject({ ok: false });
    });
  });

  describe("disease", () => {
    const setup = (race: TestSide["raceId"]) =>
      battleOf(
        [
          { seat: 0, unitId: "zombie", count: 5, x: 0, y: 0 },
          { seat: 1, unitId: "golem", count: 5, x: 1, y: 0 },
        ],
        [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: race }]
      );
    it("−3 attack for 2 rounds", () => {
      const b = setup("dwarves");
      const before = attackOf(b, stack(b, "s1_0"));
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(attackOf(b, stack(b, "s1_0"))).toBe(before - 3);
      expect(stack(b, "s1_0").statuses.find((s) => s.id === "diseased")?.untilRound).toBe(2);
    });
    it("undead are immune", () => {
      const b = setup("vampires");
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(hasStatus(stack(b, "s1_0"), "diseased")).toBe(false);
    });
  });

  describe("evasion", () => {
    const setup = (unitId: "ghost" | "zombie") =>
      battleOf([
        { seat: 0, unitId: "archer", count: 5, x: 0, y: 0 },
        { seat: 1, unitId, count: 5, x: 5, y: 0 },
      ]);
    it("dodges a hit on a successful 25% roll", () => {
      const events = act(setup("ghost"), { stackId: "s0_0", kind: "shoot", target: "s1_0" }, fixedRng({ chance: true }));
      expect(of(events, "missed")).toHaveLength(1);
      expect(damageTo(events, "s1_0")).toEqual([]);
    });
    it("a unit without it is hit even on the same roll", () => {
      const events = act(setup("zombie"), { stackId: "s0_0", kind: "shoot", target: "s1_0" }, fixedRng({ chance: true }));
      expect(of(events, "missed")).toEqual([]);
    });
  });

  describe("scream", () => {
    it("enemies within 2 deal −25% until the end of the round", () => {
      const b = battleOf([
        { seat: 0, unitId: "banshee", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "orc", count: 10, x: 2, y: 0 },
        { seat: 1, unitId: "orc", count: 10, x: 3, y: 0 },
        { seat: 0, unitId: "golem", count: 10, x: 3, y: 1 },
      ]);
      const before = minDamage(b, "s1_0", "s0_1");
      act(b, { stackId: "s0_0", kind: "ability" });
      expect(hasStatus(stack(b, "s1_0"), "scream")).toBe(true);
      expect(minDamage(b, "s1_0", "s0_1")).toBe(Math.floor(before * 0.75) || 1);
      expect(hasStatus(stack(b, "s1_1"), "scream")).toBe(false);
      expect(stack(b, "s1_0").statuses.find((s) => s.id === "scream")?.untilRound).toBe(1);
    });
    it("allies are not affected", () => {
      const b = battleOf([
        { seat: 0, unitId: "banshee", count: 5, x: 0, y: 0 },
        { seat: 0, unitId: "golem", count: 1, x: 1, y: 0 },
        { seat: 1, unitId: "orc", count: 10, x: 19, y: 19 },
      ]);
      act(b, { stackId: "s0_0", kind: "ability" });
      expect(hasStatus(stack(b, "s0_1"), "scream")).toBe(false);
    });
  });

  describe("lifesteal", () => {
    const setup = (count: number, startCount: number) =>
      battleOf([
        { seat: 0, unitId: "vampire", count, x: 0, y: 0, with: { startCount, hpTop: 1 } },
        { seat: 1, unitId: "golem", count: 20, x: 1, y: 0 },
      ]);
    it("heals 50% of the damage and revives fallen vampires", () => {
      const b = setup(2, 5);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      const dealt = damageTo(events, "s1_0")[0].amount!;
      expect(of(events, "resurrected")[0].amount).toBe(Math.floor(dealt / 2));
      expect(stack(b, "s0_0").count).toBeGreaterThanOrEqual(2);
    });
    it("never goes past the starting count", () => {
      const b = setup(5, 5);
      stack(b, "s0_0").hpTop = 28;
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(of(events, "resurrected")).toEqual([]);
      expect(stack(b, "s0_0").count).toBe(5);
    });
  });

  describe("aoe_cloud", () => {
    it("the shot also hits every stack around the target, allies included", () => {
      const b = battleOf([
        { seat: 0, unitId: "lich", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 6, y: 1 },
        { seat: 0, unitId: "miner", count: 5, x: 4, y: 2 },
        { seat: 1, unitId: "miner", count: 5, x: 7, y: 1 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" });
      const hit = new Set(of(events, "damaged").map((event) => event.stackId));
      expect([...hit].sort()).toEqual(["s0_1", "s1_0", "s1_1"]);
    });
    it("melee hits have no cloud", () => {
      const b = battleOf([
        { seat: 0, unitId: "lich", count: 5, x: 4, y: 1 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 6, y: 1 },
      ]);
      expect(damageTo(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "s1_1")).toEqual([]);
    });
  });

  describe("deathblow", () => {
    const setup = () =>
      battleOf([
        { seat: 0, unitId: "death_knight", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 20, x: 1, y: 0 },
      ]);
    it("20%: double damage", () => {
      const b = setup();
      const raw = 3 * 7 * mult(b, "s0_0", "s1_0");
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }, fixedRng({ chance: true }));
      expect(of(events, "luck")).toEqual([expect.objectContaining({ detail: "critical" })]);
      expect(damageTo(events, "s1_0")[0].amount).toBe(Math.floor(raw * 2));
    });
    it("no double on a failed roll", () => {
      const b = setup();
      const plain = minDamage(b, "s0_0", "s1_0");
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(damageTo(events, "s1_0")[0].amount).toBe(plain);
    });
  });

  describe("fear / stun / blind: skip the next activation", () => {
    const cases = [
      ["bone_dragon", "fear"],
      ["ogre", "stun"],
      ["unicorn", "blind"],
    ] as const;
    for (const [unitId, ability] of cases) {
      it(`${ability}: the target loses its activation on a successful roll`, () => {
        const b = battleOf([
          { seat: 0, unitId, count: 3, x: 0, y: 0 },
          { seat: 1, unitId: "golem", count: 30, x: 1, y: 0 },
          { seat: 1, unitId: "miner", count: 1, x: 19, y: 19 },
        ]);
        const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }, fixedRng({ chance: true }));
        expect(of(events, "skipped").map((event) => event.stackId)).toEqual(["s1_0"]);
        expect(stack(b, "s1_0").activated).toBe(true);
      });
      it(`${ability}: nothing on a failed roll`, () => {
        const b = battleOf([
          { seat: 0, unitId, count: 3, x: 0, y: 0 },
          { seat: 1, unitId: "golem", count: 30, x: 1, y: 0 },
        ]);
        expect(of(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "skipped")).toEqual([]);
      });
    }
    it("fear and blind don't work on undead, stun does", () => {
      for (const [unitId, expected] of [["bone_dragon", 0], ["unicorn", 0], ["ogre", 1]] as const) {
        const b = battleOf(
          [
            { seat: 0, unitId, count: 3, x: 0, y: 0 },
            { seat: 1, unitId: "zombie", count: 30, x: 1, y: 0 },
            { seat: 1, unitId: "zombie", count: 1, x: 19, y: 19 },
          ],
          [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: "vampires" }]
        );
        const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }, fixedRng({ chance: true }));
        expect(of(events, "skipped").filter((event) => event.stackId === "s1_0")).toHaveLength(expected);
      }
    });
    it("a target that already acted loses its first activation of the next round", () => {
      const b = battleOf([
        { seat: 0, unitId: "ogre", count: 3, x: 0, y: 0 },
        { seat: 0, unitId: "miner", count: 1, x: 19, y: 0 },
        { seat: 1, unitId: "golem", count: 30, x: 1, y: 0, with: { activated: true } },
        { seat: 1, unitId: "miner", count: 1, x: 19, y: 19, with: { activated: true } },
      ]);
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }, fixedRng({ chance: true }));
      expect(hasStatus(stack(b, "s1_0"), "skip_next")).toBe(true);
      act(b, { stackId: "s0_1", kind: "defend" });
      expect(b.round).toBe(2);
      expect(stack(b, "s1_0").activated).toBe(true);
    });
    it("a blinded stack doesn't retaliate", () => {
      const b = battleOf([
        { seat: 0, unitId: "miner", count: 3, x: 2, y: 0 },
        { seat: 1, unitId: "golem", count: 30, x: 1, y: 0, with: { statuses: [{ id: "blinded", untilRound: 1 }] } },
      ]);
      expect(of(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "retaliated")).toEqual([]);
    });
  });

  describe("hit_and_run", () => {
    it("returns to the start cell and takes no retaliation", () => {
      const b = battleOf([
        { seat: 0, unitId: "wolf_rider", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 0 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0", cell: { x: 4, y: 0 } });
      expect(stack(b, "s0_0")).toMatchObject({ x: 0, y: 0 });
      expect(of(events, "retaliated")).toEqual([]);
      expect(of(events, "moved")).toHaveLength(2);
    });
    it("other units stay where they attacked", () => {
      const b = battleOf([
        { seat: 0, unitId: "orc", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 0 },
      ]);
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0", cell: { x: 4, y: 0 } });
      expect(stack(b, "s0_0")).toMatchObject({ x: 4, y: 0 });
    });
  });

  describe("war_drum / rune_shield", () => {
    for (const [unitId, ability, check] of [
      ["shaman", "war_drum", (b: BattleState, id: string) => attackOf(b, stack(b, id))],
      ["runekeeper", "rune_shield", (b: BattleState, id: string) => defenceOf(b, stack(b, id))],
    ] as const) {
      it(`${ability}: an ally in radius 3 gets the bonus until the end of the round`, () => {
        const b = battleOf([
          { seat: 0, unitId, count: 5, x: 0, y: 0 },
          { seat: 0, unitId: "golem", count: 1, x: 3, y: 0 },
          { seat: 1, unitId: "miner", count: 1, x: 19, y: 19 },
        ]);
        const before = check(b, "s0_1");
        act(b, { stackId: "s0_0", kind: "ability", target: "s0_1" });
        expect(check(b, "s0_1")).toBe(before + (ability === "war_drum" ? 4 : 5));
        expect(stack(b, "s0_1").statuses.find((s) => s.id === ability)?.untilRound).toBe(1);
      });
      it(`${ability}: not on enemies or out of range`, () => {
        const b = battleOf([
          { seat: 0, unitId, count: 5, x: 0, y: 0 },
          { seat: 0, unitId: "golem", count: 1, x: 4, y: 0 },
          { seat: 1, unitId: "miner", count: 1, x: 1, y: 0 },
        ]);
        expect(applyAct(b, 0, { stackId: "s0_0", kind: "ability", target: "s1_0" }, testEnv())).toMatchObject({ ok: false });
        expect(applyAct(b, 0, { stackId: "s0_0", kind: "ability", target: "s0_1" }, testEnv())).toMatchObject({ ok: false });
      });
    }
    it("may follow a move", () => {
      const b = battleOf([
        { seat: 0, unitId: "shaman", count: 5, x: 0, y: 0 },
        { seat: 0, unitId: "golem", count: 1, x: 7, y: 0 },
        { seat: 1, unitId: "miner", count: 1, x: 19, y: 19 },
      ]);
      act(b, { stackId: "s0_0", kind: "ability", target: "s0_1", cell: { x: 4, y: 0 } });
      expect(stack(b, "s0_0")).toMatchObject({ x: 4, y: 0 });
      expect(hasStatus(stack(b, "s0_1"), "war_drum")).toBe(true);
    });
  });

  describe("no_melee_pen", () => {
    it("no −50% for an adjacent enemy", () => {
      const b = battleOf([
        { seat: 0, unitId: "axe_thrower", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 1, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 4, y: 0 },
      ]);
      const shots = stackOptions(b, map, stack(b, "s0_0")).shots;
      expect(shots.find((shot) => shot.target.id === "s1_1")!.penalties).toEqual([]);
    });
    it("other shooters get the penalty", () => {
      const b = battleOf([
        { seat: 0, unitId: "archer", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 1, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 4, y: 0 },
      ]);
      const shots = stackOptions(b, map, stack(b, "s0_0")).shots;
      expect(shots.find((shot) => shot.target.id === "s1_1")!.penalties).toEqual(["adjacent"]);
      expect(minDamage(b, "s0_0", "s1_0")).toBeLessThan(withAbilities("archer", ["no_melee_pen"], () => minDamage(b, "s0_0", "s1_0")));
    });
  });

  describe("lightning", () => {
    const setup = (target: "berserker" | "golem") =>
      battleOf([
        { seat: 0, unitId: "thunderbird", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: target, count: 30, x: 1, y: 0 },
      ]);
    it("25%: an extra bolt for 50% of the hit, ignoring defence", () => {
      const events = act(setup("berserker"), { stackId: "s0_0", kind: "attack", target: "s1_0" }, fixedRng({ chance: true }));
      const bolts = damageTo(events, "s1_0").filter((event) => event.detail === "lightning");
      expect(bolts).toHaveLength(1);
    });
    it("no bolt against magic immunity", () => {
      const events = act(setup("golem"), { stackId: "s0_0", kind: "attack", target: "s1_0" }, fixedRng({ chance: true }));
      expect(damageTo(events, "s1_0").filter((event) => event.detail === "lightning")).toEqual([]);
    });
  });

  describe("whirlwind", () => {
    it("hits every adjacent enemy, allies spared", () => {
      const b = battleOf([
        { seat: 0, unitId: "warlord", count: 3, x: 5, y: 1 },
        { seat: 1, unitId: "golem", count: 5, x: 6, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 4, y: 0 },
        { seat: 0, unitId: "miner", count: 5, x: 5, y: 2 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(damageTo(events, "s1_1")).toHaveLength(1);
      expect(damageTo(events, "s0_1")).toEqual([]);
    });
    it("without it only the target is hit", () => {
      const b = battleOf([
        { seat: 0, unitId: "warlord", count: 3, x: 5, y: 1 },
        { seat: 1, unitId: "golem", count: 5, x: 6, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 4, y: 0 },
      ]);
      const events = withAbilities("warlord", [], () => act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }));
      expect(damageTo(events, "s1_1")).toEqual([]);
    });
  });

  describe("boulder", () => {
    it("the shot hits every enemy around the target, not allies", () => {
      const b = battleOf([
        { seat: 0, unitId: "cyclops", count: 2, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 6, y: 2 },
        { seat: 0, unitId: "miner", count: 5, x: 4, y: 1 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" });
      expect(damageTo(events, "s1_1")).toHaveLength(1);
      expect(damageTo(events, "s0_1")).toEqual([]);
    });
    it("enemies two cells away are safe", () => {
      const b = battleOf([
        { seat: 0, unitId: "cyclops", count: 2, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 5, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 7, y: 1 },
      ]);
      expect(damageTo(act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" }), "s1_1")).toEqual([]);
    });
  });

  describe("magic_shot", () => {
    it("no range penalty and half the defence", () => {
      const b = battleOf(
        [
          { seat: 0, unitId: "druid", count: 5, x: 0, y: 0 },
          { seat: 1, unitId: "shieldbearer", count: 5, x: 15, y: 0 },
        ],
        [{ seat: 0, raceId: "dwarves" }, { seat: 1, raceId: "knights" }]
      );
      const shot = stackOptions(b, map, stack(b, "s0_0")).shots[0];
      expect(shot.penalties).toEqual([]);
      const target = stack(b, "s1_0");
      const halfDefence = kad(attackOf(b, stack(b, "s0_0")), defenceOf(b, target) / 2) / kad(attackOf(b, stack(b, "s0_0")), defenceOf(b, target));
      expect(mult(b, "s0_0", "s1_0", "ranged") / withAbilities("druid", [], () => mult(b, "s0_0", "s1_0", "ranged"))).toBeCloseTo(2 * halfDefence);
    });
    it("magic immunity keeps its full defence", () => {
      const b = battleOf([
        { seat: 0, unitId: "druid", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 3, y: 0 },
      ]);
      // `mult` counts both shots as magic (stone skin), so only the defence ignore could differ — and it doesn't
      expect(mult(b, "s0_0", "s1_0", "ranged")).toBeCloseTo(withAbilities("druid", [], () => mult(b, "s0_0", "s1_0", "ranged")));
    });
  });

  describe("entangle", () => {
    it("the target can't move during its next activation, then it can", () => {
      const b = battleOf([
        { seat: 0, unitId: "treant", count: 3, x: 0, y: 0 },
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 2 },
        { seat: 1, unitId: "golem", count: 30, x: 1, y: 0 },
      ]);
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      const golem = stack(b, "s1_0");
      expect(hasStatus(golem, "entangled")).toBe(true);
      expect(reachable(b, map, golem)).toEqual([]);
      act(b, { stackId: "s1_0", kind: "defend" });
      expect(hasStatus(golem, "entangled")).toBe(false);
      expect(reachable(b, map, golem).length).toBeGreaterThan(0);
    });
    it("shooting is still allowed while entangled", () => {
      const b = battleOf([
        { seat: 0, unitId: "dw_xbow", count: 3, x: 0, y: 0, with: { statuses: [{ id: "entangled", untilActivation: 1 }] } },
        { seat: 1, unitId: "golem", count: 30, x: 5, y: 0 },
      ]);
      const options = stackOptions(b, map, stack(b, "s0_0"));
      expect(options.moves).toEqual([]);
      expect(options.shots).toHaveLength(1);
    });
  });

  describe("breath", () => {
    it("also hits whoever stands behind the target", () => {
      const b = battleOf([
        { seat: 0, unitId: "green_dragon", count: 2, x: 3, y: 1 },
        { seat: 1, unitId: "golem", count: 5, x: 4, y: 1 },
        { seat: 0, unitId: "miner", count: 5, x: 5, y: 1 },
        { seat: 1, unitId: "miner", count: 5, x: 5, y: 2 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(damageTo(events, "s0_1")).toHaveLength(1);
      expect(damageTo(events, "s1_1")).toEqual([]);
    });
    it("nothing behind, nothing extra", () => {
      const b = battleOf([
        { seat: 0, unitId: "green_dragon", count: 2, x: 3, y: 1 },
        { seat: 1, unitId: "golem", count: 5, x: 4, y: 1 },
      ]);
      expect(of(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "damaged").filter((e) => e.detail === "splash")).toEqual([]);
    });
  });

  describe("maim", () => {
    it("−2 speed for the target's next activation", () => {
      const b = battleOf([
        { seat: 0, unitId: "bear_rider", count: 3, x: 0, y: 0 },
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 2 },
        { seat: 1, unitId: "golem", count: 30, x: 1, y: 0 },
      ]);
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      const golem = stack(b, "s1_0");
      expect(speedOf(b, golem)).toBe(1);
      act(b, { stackId: "s1_0", kind: "defend" });
      expect(speedOf(b, golem)).toBe(3);
    });
    it("no slow without it", () => {
      const b = battleOf([
        { seat: 0, unitId: "orc", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 30, x: 1, y: 0 },
      ]);
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(speedOf(b, stack(b, "s1_0"))).toBe(3);
    });
  });

  describe("rage", () => {
    it("+2 attack per hit taken, up to +6", () => {
      const b = battleOf([
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 0 },
        { seat: 1, unitId: "berserker", count: 10, x: 1, y: 0 },
      ]);
      const ctx = ctxFor(b);
      const before = attackOf(b, stack(b, "s1_0"));
      for (let i = 0; i < 4; i++) {
        strike(ctx, { attacker: stack(b, "s0_0"), target: stack(b, "s1_0"), mode: "melee", retaliation: false, moved: 0, factor: 1, splash: false, magic: false });
      }
      expect(attackOf(b, stack(b, "s1_0"))).toBe(before + 6);
    });
    it("other units don't grow angry", () => {
      const b = battleOf([
        { seat: 0, unitId: "miner", count: 1, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 1, y: 0 },
      ]);
      strike(ctxFor(b), { attacker: stack(b, "s0_0"), target: stack(b, "s1_0"), mode: "melee", retaliation: false, moved: 0, factor: 1, splash: false, magic: false });
      expect(stack(b, "s1_0").rage).toBe(0);
    });
  });

  describe("bombard", () => {
    it("attacks while flying over the target and takes no retaliation", () => {
      const b = battleOf([
        { seat: 0, unitId: "gyrocopter", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 3, y: 0 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0", cell: { x: 6, y: 0 } });
      expect(stack(b, "s0_0")).toMatchObject({ x: 6, y: 0 });
      expect(damageTo(events, "s1_0")).toHaveLength(1);
      expect(of(events, "retaliated")).toEqual([]);
    });
    it("other flyers must land next to the target", () => {
      const b = battleOf([
        { seat: 0, unitId: "griffin", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 3, y: 0 },
      ]);
      expect(applyAct(b, 0, { stackId: "s0_0", kind: "attack", target: "s1_0", cell: { x: 6, y: 0 } }, testEnv())).toMatchObject({
        ok: false,
        reason: "bad-attack-cell",
      });
    });
  });

  describe("magic_immune", () => {
    it("hero abilities can't target it", () => {
      const b = battleOf(
        [
          { seat: 0, unitId: "elf_archer", count: 1, x: 0, y: 0 },
          { seat: 1, unitId: "golem", count: 5, x: 5, y: 0 },
          { seat: 1, unitId: "miner", count: 5, x: 6, y: 0 },
        ],
        [{ seat: 0, raceId: "elves" }, { seat: 1, raceId: "dwarves" }]
      );
      expect(heroOptions(b, map, 0)!.targets).toEqual(["s1_1"]);
    });
    it("hellfire passes over it but burns the others", () => {
      const b = battleOf(
        [
          { seat: 0, unitId: "imp", count: 1, x: 0, y: 0 },
          { seat: 1, unitId: "golem", count: 5, x: 5, y: 0 },
          { seat: 1, unitId: "miner", count: 5, x: 6, y: 0 },
        ],
        [{ seat: 0, raceId: "demons" }, { seat: 1, raceId: "dwarves" }]
      );
      const result = applyHeroAbility(b, 0, { cell: { x: 5, y: 1 } }, testEnv());
      expect(result.ok).toBe(true);
      const damaged = result.ok ? result.events.filter((e) => e.type === "damaged").map((e) => e.stackId) : [];
      expect(damaged).toEqual(["s1_1"]);
    });
  });

  describe("thunderclap", () => {
    it("enemies next to the target take 50%", () => {
      const b = battleOf([
        { seat: 0, unitId: "titan", count: 2, x: 3, y: 1 },
        { seat: 1, unitId: "golem", count: 10, x: 4, y: 1 },
        { seat: 1, unitId: "golem", count: 10, x: 5, y: 1 },
        { seat: 0, unitId: "golem", count: 10, x: 4, y: 0 },
      ]);
      const main = minDamage(b, "s0_0", "s1_0");
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(damageTo(events, "s1_1")[0].amount).toBe(Math.floor(main * 0.5));
      expect(damageTo(events, "s0_1")).toEqual([]);
    });
    it("no splash without neighbours", () => {
      const b = battleOf([
        { seat: 0, unitId: "titan", count: 2, x: 3, y: 1 },
        { seat: 1, unitId: "golem", count: 10, x: 4, y: 1 },
      ]);
      expect(of(act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" }), "damaged").filter((e) => e.detail === "splash")).toEqual([]);
    });
  });

  describe("chain_shot", () => {
    it("jumps to the nearest other enemy within 2 for 50%", () => {
      const b = battleOf([
        { seat: 0, unitId: "succubus", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 5, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 7, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 6, y: 1 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" });
      expect(damageTo(events, "s1_2")).toHaveLength(1);
      expect(damageTo(events, "s1_1")).toEqual([]);
    });
    it("no jump when nobody is within 2", () => {
      const b = battleOf([
        { seat: 0, unitId: "succubus", count: 5, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 5, y: 0 },
        { seat: 1, unitId: "golem", count: 10, x: 8, y: 0 },
      ]);
      expect(damageTo(act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" }), "s1_1")).toEqual([]);
    });
  });

  describe("teleport", () => {
    it("reaches any free cell within speed, past enemies", () => {
      const b = battleOf([
        { seat: 0, unitId: "abyss_shade", count: 1, x: 0, y: 1 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 0 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 1 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 2 },
        { seat: 1, unitId: "miner", count: 1, x: 0, y: 2 },
        { seat: 1, unitId: "miner", count: 1, x: 0, y: 0 },
      ]);
      const cells = reachable(b, map, stack(b, "s0_0")).map((reach) => `${reach.cell.x},${reach.cell.y}`);
      expect(cells).toContain("5,1");
    });
    it("a walker is boxed in by enemies", () => {
      const b = battleOf([
        { seat: 0, unitId: "horned", count: 1, x: 0, y: 1 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 0 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 1 },
        { seat: 1, unitId: "miner", count: 1, x: 1, y: 2 },
        { seat: 1, unitId: "miner", count: 1, x: 0, y: 2 },
        { seat: 1, unitId: "miner", count: 1, x: 0, y: 0 },
      ]);
      expect(reachable(b, map, stack(b, "s0_0"))).toEqual([]);
    });
  });

  describe("fire_shield", () => {
    it("melee attackers take 20% of the damage they deal", () => {
      const b = battleOf([
        { seat: 0, unitId: "orc", count: 20, x: 0, y: 0 },
        { seat: 1, unitId: "efreet", count: 10, x: 1, y: 0 },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      const dealt = damageTo(events, "s1_0")[0].amount!;
      expect(damageTo(events, "s0_0").find((event) => event.detail === "reflect")?.amount).toBe(Math.floor(dealt * 0.2));
    });
    it("shots are not reflected", () => {
      const b = battleOf([
        { seat: 0, unitId: "archer", count: 20, x: 0, y: 0 },
        { seat: 1, unitId: "efreet", count: 10, x: 5, y: 0 },
      ]);
      expect(damageTo(act(b, { stackId: "s0_0", kind: "shoot", target: "s1_0" }), "s0_0")).toEqual([]);
    });
  });

  describe("burn", () => {
    it("15% of the hit at the end of this round and the next, then stops", () => {
      const b = battleOf([
        { seat: 0, unitId: "pitlord", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 5, x: 1, y: 0, with: { activated: true } },
      ]);
      const events = act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      const dealt = damageTo(events, "s1_0")[0].amount!;
      const burns = damageTo(events, "s1_0").filter((event) => event.detail === "burn");
      expect(burns).toEqual([expect.objectContaining({ amount: Math.floor(dealt * 0.15) })]);
      expect(b.round).toBe(2);
      // round 2: both act, burn ticks again at the end, round 3 has none
      const round2 = [...act(b, { stackId: b.activeSeat === 0 ? "s0_0" : "s1_0", kind: "defend" })];
      round2.push(...act(b, { stackId: b.activeSeat === 0 ? "s0_0" : "s1_0", kind: "defend" }));
      expect(damageTo(round2, "s1_0").filter((event) => event.detail === "burn")).toHaveLength(1);
      expect(hasStatus(stack(b, "s1_0"), "burning")).toBe(false);
    });
    it("units without it don't set fire", () => {
      const b = battleOf([
        { seat: 0, unitId: "orc", count: 3, x: 0, y: 0 },
        { seat: 1, unitId: "golem", count: 30, x: 1, y: 0 },
      ]);
      act(b, { stackId: "s0_0", kind: "attack", target: "s1_0" });
      expect(hasStatus(stack(b, "s1_0"), "burning")).toBe(false);
    });
  });
});

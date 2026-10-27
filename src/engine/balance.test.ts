import { describe, expect, it } from "vitest";
import { kad, unitCost } from "./balance";
import { RACES, UNIT_IDS, UNITS } from "./data/races";

describe("balance formula (design §4)", () => {
  it("reproduces the cost of all 60 units", () => {
    expect(UNIT_IDS).toHaveLength(60);
    const mismatches = UNIT_IDS.filter((id) => unitCost(UNITS[id]) !== UNITS[id].cost).map(
      (id) => `${id}: formula ${unitCost(UNITS[id])}, data ${UNITS[id].cost}`
    );
    expect(mismatches).toEqual([]);
  });

  it("matches the race totals from the design doc", () => {
    const totals = Object.fromEntries(
      Object.values(RACES).map((race) => [race.id, race.units.reduce((sum, id) => sum + UNITS[id].cost, 0)])
    );
    expect(totals).toEqual({ knights: 1350, vampires: 1355, barbarians: 1340, elves: 1440, dwarves: 1390, demons: 1450 });
  });

  it("caps K_AD at 3.0 and 0.3", () => {
    expect(kad(8, 8)).toBe(1);
    expect(kad(12, 8)).toBeCloseTo(1.2);
    expect(kad(100, 0)).toBe(3);
    expect(kad(8, 12)).toBeCloseTo(0.9);
    expect(kad(0, 100)).toBe(0.3);
  });

  it("keeps every race at 10 units with the champion as tier 10", () => {
    for (const race of Object.values(RACES)) {
      expect(race.units.map((id) => UNITS[id].tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(race.units.every((id) => UNITS[id].raceId === race.id)).toBe(true);
      const hero = race.hero;
      expect(hero.atk + hero.def + hero.luck + hero.morale).toBe(5);
    }
  });
});

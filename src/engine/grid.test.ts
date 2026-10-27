import { describe, expect, it } from "vitest";
import { MAPS } from "./data/maps";
import { cellIndex, deployZone, getMap, validateMap } from "./grid";

describe("maps (design §8)", () => {
  it("has 8 maps that all validate: zones free, every free cell reachable on foot", () => {
    expect(MAPS).toHaveLength(8);
    for (const def of MAPS) {
      expect({ map: def.id, problems: validateMap(getMap(def.id)) }).toEqual({ map: def.id, problems: [] });
    }
  });

  it("builds the obstacle counts from the design doc", () => {
    const counts = Object.fromEntries(MAPS.map((def) => [def.id, getMap(def.id).blocked.filter(Boolean).length]));
    expect(counts).toEqual({ arena: 8, valley: 16, mill: 24, river: 28, graveyard: 24, lava: 28, pass: 42, village: 60 });
  });

  it("applies rot4 symmetry to the arena pillars", () => {
    const arena = getMap("arena");
    const pillars = arena.objects.filter((o) => o.t === "pillar").map((o) => `${o.x},${o.y}`).sort();
    expect(pillars).toEqual(["3,3", "3,6", "6,3", "6,6"]);
    expect(arena.high.filter(Boolean)).toHaveLength(4);
  });

  it("keeps bridges walkable over the river", () => {
    const river = getMap("river");
    expect(river.blocked[cellIndex(river, { x: 6, y: 2 })]).toBe(false);
    expect(river.blocked[cellIndex(river, { x: 7, y: 2 })]).toBe(false);
    expect(river.blocked[cellIndex(river, { x: 6, y: 0 })]).toBe(true);
  });

  it("sizes deploy zones by map and boots", () => {
    expect(deployZone(getMap("arena"), "two", 1)).toHaveLength(20);
    expect(deployZone(getMap("arena"), "two", 1, 1)).toHaveLength(30);
    expect(deployZone(getMap("mill"), "four", 2)).toHaveLength(9);
    expect(deployZone(getMap("graveyard"), "four", 3)).toHaveLength(16);
    expect(deployZone(getMap("graveyard"), "four", 3, 1)).toHaveLength(25);
    expect(deployZone(getMap("arena"), "four", 2)[0]).toEqual({ x: 7, y: 7 });
  });
});

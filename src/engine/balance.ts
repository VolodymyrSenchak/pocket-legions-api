import { ABILITIES } from "./data/abilities";
import { BALANCE } from "./data/items";
import type { UnitDef } from "./types";

/** Attack/defence multiplier from the combat formula (design §3). */
export function kad(attack: number, defence: number): number {
  const diff = attack - defence;
  return diff >= 0 ? Math.min(1 + 0.05 * diff, 3) : Math.max(1 - 0.025 * -diff, 0.3);
}

type PowerInput = Pick<UnitDef, "atk" | "def" | "dmg" | "hp" | "spd" | "fly" | "hits" | "ranged" | "abilities">;

/** Unit power (design §4), the same formula as design/tools/build.js. */
export function unitPower(unit: PowerInput): number {
  const avg = (unit.dmg[0] + unit.dmg[1]) / 2;
  // a melee double strike is weaker than 2×: the enemy retaliates between the hits
  const hitsF = unit.ranged ? unit.hits : 1 + 0.6 * (unit.hits - 1);
  const effDmg = avg * kad(unit.atk, BALANCE.REF) * hitsF;
  const effHp = unit.hp / kad(BALANCE.REF, unit.def);
  const base = Math.sqrt(effDmg * effHp);
  const speedF = 1 + 0.04 * (unit.spd - 5);
  const rangedF = unit.ranged ? 1.25 + 0.02 * (unit.ranged.range - 6) - Math.max(0, 8 - unit.ranged.shots) * 0.03 : 1;
  const flyF = unit.fly ? 1.1 : 1;
  const abilF = 1 + unit.abilities.reduce((sum, id) => sum + ABILITIES[id].weight, 0);
  return base * speedF * rangedF * flyF * abilF;
}

export function round5(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

/** Points per unit: round5(K × power). */
export function unitCost(unit: PowerInput): number {
  return round5(BALANCE.K * unitPower(unit));
}

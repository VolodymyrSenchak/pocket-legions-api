import { ABILITY_IDS, AbilityId } from "./data/abilities";
import { addStatus, applyDamage, applySkip, healStack, untilNextActivation } from "./effects";
import { DIRECTIONS, distance, isAdjacent } from "./grid";
import { roll } from "./rng";
import { areAllies, BattleCtx, BattleState, cellOf, isAlive, livingStacks, stackAt, StackState } from "./state";
import { hasAbility, isUndead, raceOf, unitOf } from "./stats";
import type { Cell } from "./types";

/** One damage application: a melee blow, a shot, a retaliation or a splash. */
export interface Hit {
  attacker: StackState;
  target: StackState;
  mode: "melee" | "ranged";
  retaliation: boolean;
  /** Cells the attacker moved before this attack (charge). */
  moved: number;
  /** Share of the damage: 1 for the main hit, 0.5 for thunderclap/chain splash. */
  factor: number;
  splash: boolean;
  /** From a magical ability: stone skin −25%, magic immunity = no effect. */
  magic: boolean;
}

/** Deals one splash hit; supplied by damage.ts so the area hooks stay data-like. */
export type SplashFn = (target: StackState, factor: number, magic: boolean) => void;

/** A support action that replaces the attack (it may follow a move). */
export interface ActiveAbility {
  /** `ally` = needs an allied target stack; `none` = acts around the caster. */
  target: "ally" | "none";
  /** Chebyshev radius from the caster's cell; null = anywhere on the field. */
  radius: number | null;
  canTarget(ctx: BattleCtx, caster: StackState, target: StackState): boolean;
  apply(ctx: BattleCtx, caster: StackState, target: StackState | null): void;
}

/** Plan §6.6: every ability is a set of hooks the damage pipeline and the battle loop ask for. */
export interface AbilityHooks {
  movement?: "teleport";
  /** Attacker: multiplier on the target's defence (piercing 0.6, magic shot 0.5). */
  defenceFactor?: (hit: Hit) => number;
  /** Attacker: damage multiplier (charge, holy). */
  attackFactor?: (battle: BattleState, hit: Hit) => number;
  /** Target: damage multiplier (shield, bone body). */
  takenFactor?: (hit: Hit) => number;
  /** Target: percent chance to dodge a hit completely. */
  evasion?: number;
  /** Attacker: a separate "critical" roll next to luck (deathblow). */
  critical?: { percent: number; factor: number };
  /** Attacker, after a main hit or a retaliation landed. */
  onHit?: (ctx: BattleCtx, hit: Hit, dealt: number) => void;
  /** Target, after taking a main hit or a retaliation. */
  onHitTaken?: (ctx: BattleCtx, hit: Hit, dealt: number) => void;
  /** Attacker, after the main hit of its own action (not retaliation). */
  area?: (ctx: BattleCtx, hit: Hit, splash: SplashFn) => void;
  /** Attacker: the target never retaliates. */
  preventsRetaliation?: boolean;
  /** Target: retaliates against every melee hit. */
  unlimitedRetaliation?: boolean;
  /** Shots ignore the over-range penalty. */
  ignoresRangePenalty?: boolean;
  /** No −50% for a shooter with an adjacent enemy (shooting or in melee). */
  noMeleePenalty?: boolean;
  /** Melee attack made while flying over the target (landing cell needn't be adjacent). */
  flyOverAttack?: boolean;
  /** Goes back to the cell it started from after the attack. */
  returnsAfterAttack?: boolean;
  /** Hero abilities and magical abilities have no effect on it. */
  magicImmune?: boolean;
  /** Hits (or shots) twice per action; the count is UnitDef.hits. */
  doubleHit?: "melee" | "ranged";
  active?: ActiveAbility;
}

const ally = (ctx: BattleCtx, a: StackState, b: StackState) => areAllies(ctx.battle, a.seat, b.seat);
const enemiesAround = (ctx: BattleCtx, center: Cell, of: StackState) =>
  livingStacks(ctx.battle).filter((stack) => !ally(ctx, stack, of) && isAdjacent(stack, center));

export function isMagicImmune(stack: StackState): boolean {
  return hasAbility(stack, "magic_immune");
}

/** Undead ignore fear, disease and blindness (design §5). */
function resists(ctx: BattleCtx, target: StackState, effect: "fear" | "disease" | "blind"): boolean {
  return isUndead(ctx.battle, target) && ["fear", "disease", "blind"].includes(effect);
}

function skipOnHit(effect: "stun" | "fear" | "blind", percent: number): AbilityHooks["onHit"] {
  return (ctx, hit) => {
    if (!isAlive(hit.target) || (effect !== "stun" && resists(ctx, hit.target, effect))) return;
    if (roll(ctx.rng, percent)) applySkip(ctx, hit.target, effect, hit.attacker.id);
  };
}

function buff(id: "war_drum" | "rune_shield"): ActiveAbility {
  return {
    target: "ally",
    radius: 3,
    canTarget: () => true,
    apply: (ctx, caster, target) => addStatus(ctx, target!, { id, untilRound: ctx.battle.round }, caster.id),
  };
}

export const ABILITY_HOOKS: Record<AbilityId, AbilityHooks> = {
  shield: { takenFactor: (hit) => (hit.mode === "ranged" ? 0.5 : 1) },
  bone: { takenFactor: (hit) => (hit.mode === "ranged" ? 0.5 : 1) },
  no_retal: { preventsRetaliation: true },
  unlim_retal: { unlimitedRetaliation: true },
  double_strike: { doubleHit: "melee" },
  double_shot: { doubleHit: "ranged" },
  charge: {
    attackFactor: (_battle, hit) => (hit.mode === "melee" && !hit.retaliation ? 1 + 0.06 * Math.min(hit.moved, 6) : 1),
  },
  piercing: { defenceFactor: () => 0.6 },
  heal: {
    active: {
      target: "ally",
      radius: 3,
      canTarget: (_ctx, _caster, target) => target.hpTop < unitOf(target).hp,
      apply: (ctx, caster, target) => {
        healStack(ctx, target!, 4 * caster.count, false, "heal");
      },
    },
  },
  holy: {
    attackFactor: (battle, hit) => (["vampires", "demons"].includes(raceOf(battle, hit.target)) ? 1.5 : 1),
  },
  resurrect: {
    active: {
      target: "ally",
      radius: null,
      canTarget: (_ctx, caster, target) => !caster.resurrectUsed && target.count < target.startCount,
      apply: (ctx, caster, target) => {
        caster.resurrectUsed = true;
        healStack(ctx, target!, 40 * caster.count, true, "resurrect");
      },
    },
  },
  disease: {
    onHit: (ctx, hit) => {
      if (isAlive(hit.target) && !resists(ctx, hit.target, "disease")) {
        addStatus(ctx, hit.target, { id: "diseased", untilRound: ctx.battle.round + 1 }, hit.attacker.id);
      }
    },
  },
  evasion: { evasion: 25 },
  scream: {
    active: {
      target: "none",
      radius: 2,
      canTarget: () => false,
      apply: (ctx, caster) => {
        for (const enemy of livingStacks(ctx.battle)) {
          if (!ally(ctx, enemy, caster) && distance(enemy, caster) <= 2 && !isMagicImmune(enemy)) {
            addStatus(ctx, enemy, { id: "scream", untilRound: ctx.battle.round }, caster.id);
          }
        }
      },
    },
  },
  lifesteal: {
    onHit: (ctx, hit, dealt) => {
      healStack(ctx, hit.attacker, Math.floor(dealt * 0.5), true, "lifesteal");
    },
  },
  aoe_cloud: {
    area: (ctx, hit, splash) => {
      if (hit.mode !== "ranged") return;
      for (const d of DIRECTIONS) {
        const stack = stackAt(ctx.battle, { x: hit.target.x + d.x, y: hit.target.y + d.y });
        if (stack) splash(stack, 1, true);
      }
    },
  },
  deathblow: { critical: { percent: 20, factor: 2 } },
  fear: { onHit: skipOnHit("fear", 15) },
  hit_and_run: { preventsRetaliation: true, returnsAfterAttack: true },
  war_drum: { active: buff("war_drum") },
  no_melee_pen: { noMeleePenalty: true },
  stun: { onHit: skipOnHit("stun", 20) },
  lightning: {
    onHit: (ctx, hit, dealt) => {
      if (!isAlive(hit.target) || isMagicImmune(hit.target) || !roll(ctx.rng, 25)) return;
      const stoneSkin = raceOf(ctx.battle, hit.target) === "dwarves" ? 0.75 : 1;
      applyDamage(ctx, hit.target, Math.max(1, Math.floor(dealt * 0.5 * stoneSkin)), {
        sourceId: hit.attacker.id,
        detail: "lightning",
      });
    },
  },
  whirlwind: {
    area: (ctx, hit, splash) => {
      if (hit.mode !== "melee") return;
      for (const enemy of enemiesAround(ctx, cellOf(hit.attacker), hit.attacker)) {
        if (enemy !== hit.target) splash(enemy, 1, false);
      }
    },
  },
  boulder: {
    area: (ctx, hit, splash) => {
      if (hit.mode !== "ranged") return;
      for (const enemy of enemiesAround(ctx, cellOf(hit.target), hit.attacker)) splash(enemy, 1, false);
    },
  },
  magic_shot: {
    defenceFactor: (hit) => (hit.mode === "ranged" && !isMagicImmune(hit.target) ? 0.5 : 1),
    ignoresRangePenalty: true,
  },
  blind: { onHit: skipOnHit("blind", 20) },
  entangle: {
    onHit: (_ctx, hit) => {
      if (isAlive(hit.target)) {
        addStatus(_ctx, hit.target, { id: "entangled", untilActivation: untilNextActivation(hit.target) }, hit.attacker.id);
      }
    },
  },
  breath: {
    area: (ctx, hit, splash) => {
      if (hit.mode !== "melee") return;
      const behind = {
        x: hit.target.x + Math.sign(hit.target.x - hit.attacker.x),
        y: hit.target.y + Math.sign(hit.target.y - hit.attacker.y),
      };
      const stack = stackAt(ctx.battle, behind);
      if (stack && stack !== hit.attacker) splash(stack, 1, false);
    },
  },
  maim: {
    onHit: (ctx, hit) => {
      if (isAlive(hit.target)) {
        addStatus(ctx, hit.target, { id: "maimed", untilActivation: untilNextActivation(hit.target) }, hit.attacker.id);
      }
    },
  },
  rune_shield: { active: buff("rune_shield") },
  rage: {
    onHitTaken: (_ctx, hit) => {
      if (isAlive(hit.target)) hit.target.rage = Math.min(6, hit.target.rage + 2);
    },
  },
  bombard: { preventsRetaliation: true, flyOverAttack: true },
  magic_immune: { magicImmune: true },
  thunderclap: {
    area: (ctx, hit, splash) => {
      if (hit.mode !== "melee") return;
      for (const enemy of enemiesAround(ctx, cellOf(hit.target), hit.attacker)) {
        if (enemy !== hit.target && enemy !== hit.attacker) splash(enemy, 0.5, false);
      }
    },
  },
  chain_shot: {
    area: (ctx, hit, splash) => {
      if (hit.mode !== "ranged") return;
      const next = livingStacks(ctx.battle)
        .filter((stack) => stack !== hit.target && !ally(ctx, stack, hit.attacker) && distance(stack, hit.target) <= 2)
        .sort((a, b) => distance(a, hit.target) - distance(b, hit.target) || a.id.localeCompare(b.id))[0];
      if (next) splash(next, 0.5, false);
    },
  },
  teleport: { movement: "teleport" },
  fire_shield: {
    onHitTaken: (ctx, hit, dealt) => {
      const reflected = Math.floor(dealt * 0.2);
      if (hit.mode === "melee" && reflected > 0 && isAlive(hit.attacker)) {
        applyDamage(ctx, hit.attacker, reflected, { sourceId: hit.target.id, detail: "reflect" });
      }
    },
  },
  burn: {
    onHit: (ctx, hit, dealt) => {
      if (isAlive(hit.target)) {
        const perRound = Math.max(1, Math.floor(dealt * 0.15));
        addStatus(ctx, hit.target, { id: "burning", untilRound: ctx.battle.round + 1, value: perRound }, hit.attacker.id);
      }
    },
  },
};

export function hooksOf(stack: StackState): AbilityHooks[] {
  return unitOf(stack).abilities.map((id) => ABILITY_HOOKS[id]);
}

export function someHook(stack: StackState, predicate: (hooks: AbilityHooks) => boolean | undefined): boolean {
  return hooksOf(stack).some((hooks) => Boolean(predicate(hooks)));
}

/** The unit's support ability, if it has one (no unit has two). */
export function activeAbilityOf(stack: StackState): { id: AbilityId; ability: ActiveAbility } | null {
  for (const id of unitOf(stack).abilities) {
    const ability = ABILITY_HOOKS[id].active;
    if (ability) return { id, ability };
  }
  return null;
}

export { ABILITY_IDS };

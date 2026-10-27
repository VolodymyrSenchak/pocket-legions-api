import type { AbilityId } from "./data/abilities";
import type { ItemId, SingleSlot, Slot } from "./data/items";
import type { MapId } from "./data/maps";
import type { HeroAbilityId, RaceId, UnitId } from "./data/races";

export type { AbilityId, HeroAbilityId, ItemId, MapId, RaceId, SingleSlot, Slot, UnitId };

export interface Cell {
  x: number;
  y: number;
}

export interface AbilityDef {
  name: string;
  /** Cost surcharge in the balance formula (0.15 = +15%). */
  weight: number;
  desc: string;
}

export interface UnitDef {
  id: UnitId;
  raceId: RaceId;
  /** 1..10; tier 10 is the race champion. */
  tier: number;
  name: string;
  atk: number;
  def: number;
  dmg: [number, number];
  hp: number;
  spd: number;
  fly: boolean;
  /** Hits (or shots) per action: 2 for double strike / double shot. */
  hits: number;
  ranged?: { range: number; shots: number };
  abilities: AbilityId[];
  /** Points per unit, copied from design/generated/units.json. */
  cost: number;
}

export interface HeroDef {
  id: string;
  name: string;
  atk: number;
  def: number;
  luck: number;
  morale: number;
  ability: { id: HeroAbilityId; name: string; desc: string };
}

export type TraitId = "formation" | "undead" | "fury" | "forest_eye" | "stone_skin" | "chaos";

export interface RaceDef {
  id: RaceId;
  name: string;
  fullName: string;
  lore: string;
  trait: { id: TraitId; name: string; desc: string };
  hero: HeroDef;
  units: UnitId[];
}

export interface ItemEffects {
  atk?: number;
  def?: number;
  luck?: number;
  morale?: number;
  /** cloak_shadow: −0.15 → shots deal 15% less to your stacks. */
  rangedTaken?: number;
  /** mantle: hero ability +50% power. */
  heroPower?: number;
  /** mantle: +1 hero ability use. */
  heroUses?: number;
  /** cloak_wind: +1 speed in round 1. */
  spdRound1?: number;
  /** shield_guard: +1 retaliation per round. */
  retaliations?: number;
  /** boots_march: +1 speed for ground stacks. */
  spdGround?: number;
  /** boots_scout: deploy zone one row deeper. */
  deployRows?: number;
  /** sandals: +1 speed for flyers. */
  spdFly?: number;
  /** ring_sniper: shooters +2 range… */
  range?: number;
  /** …and +1 shot. */
  shots?: number;
  /** ring_blood: melee stacks heal 10% of the melee damage they deal. */
  meleeLifesteal?: number;
  /** shield_dragon: −20% damage from enemy hero abilities. */
  heroDmgTaken?: number;
}

export interface ItemDef {
  id: ItemId;
  slot: Slot;
  name: string;
  /** For a 1000-point budget. */
  cost: number;
  fx: ItemEffects;
  text?: string;
}

/** What a player bought in the army phase. */
export interface Army {
  stacks: { unitId: UnitId; count: number }[];
  items: Partial<Record<SingleSlot, ItemId>>;
  rings: ItemId[];
}

export type GameMode = "ffa" | "teams";

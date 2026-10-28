import { stackOptions } from "../engine/battle";
import { preview, Preview, ShotPenalty } from "../engine/damage";
import { getMap } from "../engine/grid";
import { heroOptions } from "../engine/heroes";
import type { BattleState } from "../engine/state";
import { actableStacks } from "../engine/turns";
import type { AbilityId, Cell, HeroAbilityId } from "../engine/types";

// Plan §7.5: the moves the active player may make, built from the same options `act` validates against.

export interface StackHints {
  stackId: string;
  moves: Cell[];
  /** `from`: cells to attack from (bombard: to land on); `preview` assumes the first (cheapest) one. */
  attacks: { targetId: string; from: Cell[]; preview: Preview }[];
  shots: { targetId: string; penalty: ShotPenalty[]; preview: Preview }[];
  /** `targets` empty = the ability needs no target (scream). */
  abilities: { abilityId: AbilityId; targets: string[] }[];
  canDefend: boolean;
}

export interface HeroHints {
  abilityId: HeroAbilityId;
  targets: string[];
  /** Blood ritual: your stacks that can take the heal. */
  allies: string[];
  cells: Cell[];
}

export interface Hints {
  stacks: StackHints[];
  hero: HeroHints | null;
}

const plain = (cell: Cell): Cell => ({ x: cell.x, y: cell.y });

/** Hints for `seat`, or null when it isn't that seat's turn. */
export function buildHints(battle: BattleState, seat: number): Hints | null {
  if (battle.result || battle.activeSeat !== seat) return null;
  const map = getMap(battle.mapId);
  const stacks = actableStacks(battle)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((stack): StackHints => {
      const options = stackOptions(battle, map, stack);
      return {
        stackId: stack.id,
        moves: options.moves.map((reach) => plain(reach.cell)),
        attacks: options.attacks.map((attack) => ({
          targetId: attack.target.id,
          from: attack.from.map((reach) => plain(reach.cell)),
          preview: preview(battle, {
            attacker: stack,
            target: attack.target,
            mode: "melee",
            moved: attack.from[0].cost,
            retaliation: false,
          }),
        })),
        shots: options.shots.map((shot) => ({
          targetId: shot.target.id,
          penalty: shot.penalties,
          preview: preview(battle, { attacker: stack, target: shot.target, mode: "ranged", moved: 0, retaliation: false }),
        })),
        abilities: options.abilities.map((ability) => ({
          abilityId: ability.abilityId,
          targets: ability.targets.map((target) => target.id),
        })),
        canDefend: options.canDefend,
      };
    });
  const hero = heroOptions(battle, map, seat);
  return {
    stacks,
    hero: hero ? { abilityId: hero.abilityId, targets: hero.targets, allies: hero.allies, cells: hero.cells.map(plain) } : null,
  };
}


import { describe, expect, it } from "vitest";
import { countProblems, legalActions, positionProblems, randomHeroPayload, randomSetup } from "../testing/fuzz";
import { testEnv } from "../testing/engine";
import { createSeededRng } from "../utils/random";
import { applyAct, applyHeroAbility, applyTimeout, createBattle, eliminateSeat } from "./battle";
import { getMap } from "./grid";
import { heroOptions } from "./heroes";
import { GameEvent, ROUND_LIMIT } from "./state";
import { actableStacks } from "./turns";

// Plan §6.9: random maps, random legal armies, random legal actions; the invariants must hold after every step.

const BATTLES = 500;

describe("fuzz: 500 random battles", () => {
  it("keeps every invariant and always finishes by round 30", () => {
    const outcomes = { elimination: 0, "round-limit": 0, surrender: 0 };
    for (let i = 0; i < BATTLES; i++) {
      const rng = createSeededRng(10_000 + i);
      const env = testEnv(rng);
      const setup = randomSetup(rng);
      const map = getMap(setup.mapId);
      const { battle, events: startEvents } = createBattle(setup, env);
      const label = `battle ${i} (${setup.mapId}, ${setup.mode}, ${setup.sides.length}p)`;
      let lastSeq = startEvents.at(-1)!.seq;
      const checkEvents = (events: GameEvent[]) => {
        for (const event of events) {
          if (event.seq <= lastSeq) throw new Error(`${label}: seq ${event.seq} after ${lastSeq}`);
          lastSeq = event.seq;
        }
      };

      for (let step = 0; !battle.result; step++) {
        if (step > 5000) throw new Error(`${label}: no end after 5000 steps`);
        const seat = battle.activeSeat;
        const dice = rng.int(1000);
        if (dice < 2) {
          checkEvents(eliminateSeat(battle, seat, env, "surrender"));
        } else if (dice < 20) {
          checkEvents(applyTimeout(battle, env));
        } else {
          const hero = dice < 120 ? heroOptions(battle, map, seat) : null;
          const payload = hero && randomHeroPayload(rng, hero);
          if (payload) {
            const used = applyHeroAbility(battle, seat, payload, env);
            if (!used.ok) throw new Error(`${label}: legal hero ability rejected: ${used.reason}`);
            checkEvents(used.events);
          }
          if (!battle.result && battle.activeSeat === seat) {
            const stack = rng.pick(actableStacks(battle));
            const actions = legalActions(battle, map, stack);
            // an illegal action changes nothing
            if (dice % 7 === 0) {
              const before = JSON.stringify(battle);
              const bad = applyAct(battle, seat, { stackId: stack.id, kind: "move", cell: { x: -1, y: 0 } }, env);
              expect(bad.ok).toBe(false);
              expect(JSON.stringify(battle)).toBe(before);
            }
            const result = applyAct(battle, seat, rng.pick(actions), env);
            if (!result.ok) throw new Error(`${label}: legal action rejected: ${result.reason}`);
            checkEvents(result.events);
          }
        }
        const problems = [...positionProblems(battle, map), ...countProblems(battle)];
        if (problems.length) throw new Error(`${label} step ${step}: ${problems.join("; ")}`);
        if (battle.round > ROUND_LIMIT) throw new Error(`${label}: round ${battle.round}`);
        if (battle.events.length > 64) throw new Error(`${label}: ${battle.events.length} events in state`);
      }
      outcomes[battle.result.reason] += 1;
    }
    expect(outcomes.elimination + outcomes["round-limit"] + outcomes.surrender).toBe(BATTLES);
    expect(outcomes.elimination).toBeGreaterThan(0);
  }, 300_000);
});

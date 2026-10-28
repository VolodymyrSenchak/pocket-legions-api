import { describe, expect, it } from "vitest";
import { getMap } from "../engine/grid";
import { countProblems, positionProblems, randomSetupShape } from "../testing/fuzz";
import { GameDriver } from "../testing/game";
import { createSeededRng } from "../utils/random";

// Plan §6.9, the projection invariant: random games through module.actions; every view of every player is checked.

const GAMES = 50;
const SEAT_KEYS = ["armyReady", "deployReady", "eliminated", "playerId", "raceId", "seat", "team"];

describe("fuzz: random games through the module", () => {
  it("never leaks a hidden field and keeps the battle invariants", () => {
    for (let i = 0; i < GAMES; i++) {
      const rng = createSeededRng(50_000 + i);
      const shape = randomSetupShape(rng);
      const players = ["p0", "p1", "p2", "p3"].slice(0, shape.players);
      const game = new GameDriver(players, { mapId: shape.mapId, mode: shape.mode, budget: shape.budget as 1000 }, rng);
      const label = `game ${i} (${shape.mapId}, ${shape.mode}, ${shape.players}p)`;
      const checkViews = () => {
        let maxSeq = 0;
        for (const viewer of players) {
          const view = game.view(viewer);
          const json = JSON.stringify(view);
          // `mine` is the viewer's own army and deployment; nothing else may carry an army, a deployment or internals
          const outsideMine = JSON.stringify({ ...view, mine: null });
          for (const hidden of ["killedThisRound", "nextSeq", "timeoutsInRow", "\"army\":", "\"deployment\":", "stackIndex", "activations"]) {
            if (outsideMine.includes(hidden)) throw new Error(`${label}: ${viewer} sees ${hidden}`);
          }
          for (const seat of view.seats) expect(Object.keys(seat).sort()).toEqual(SEAT_KEYS);
          if (game.state.phase !== "battle" && game.state.phase !== "over") {
            const others = game.state.seats.filter((seat) => seat.playerId !== viewer);
            for (const other of others) {
              for (const stack of other.army?.stacks ?? []) {
                const mineHasIt = view.mine?.army?.stacks.some((own) => own.unitId === stack.unitId);
                if (!mineHasIt && json.includes(`"${stack.unitId}"`)) throw new Error(`${label}: ${viewer} sees ${other.playerId}'s ${stack.unitId}`);
              }
            }
          }
          const active = game.state.battle && !game.state.battle.result ? game.playerOfSeat(game.state.battle.activeSeat) : null;
          if ((view.hints !== null) !== (viewer === active)) throw new Error(`${label}: hints for ${viewer}, active ${active}`);
          const seqs = view.events.map((event) => event.seq);
          if (seqs.some((seq, k) => k > 0 && seq <= seqs[k - 1])) throw new Error(`${label}: seq not increasing`);
          maxSeq = Math.max(maxSeq, ...seqs, 0);
        }
        if (game.state.battle) {
          const problems = [...positionProblems(game.state.battle, getMap(shape.mapId)), ...countProblems(game.state.battle)];
          if (problems.length) throw new Error(`${label}: ${problems.join("; ")}`);
          if (game.state.battle.round > 30) throw new Error(`${label}: round ${game.state.battle.round}`);
        }
        return maxSeq;
      };

      // army phase: one by one, with views checked in between
      for (const seat of game.state.seats) {
        checkViews();
        game.act(seat.playerId, "pickRace", { raceId: rng.pick(["knights", "vampires", "barbarians", "elves", "dwarves", "demons"]) });
      }
      game.randomArmies();
      checkViews();
      game.randomDeployments();
      let lastSeq = checkViews();
      for (let step = 0; game.state.phase === "battle"; step++) {
        if (step > 3000) throw new Error(`${label}: no end`);
        if (rng.int(100) < 3) {
          game.now = Date.parse(game.state.battle!.turnDeadline);
          game.act(players[rng.int(players.length)], "claimTimeout");
        } else {
          game.randomTurn();
        }
        const seq = checkViews();
        if (seq < lastSeq) throw new Error(`${label}: seq went back`);
        lastSeq = seq;
      }
      expect(game.state.phase).toBe("over");
      // the room stays open for a rematch
      expect(game.finished).toBe(false);
    }
  }, 300_000);
});

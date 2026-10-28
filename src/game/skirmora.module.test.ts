import { describe, expect, it } from "vitest";
import { actionsFromHints, GameDriver, GAME_START } from "../testing/game";
import { createHttpHarness } from "../testing/harness";
import { createSeededRng } from "../utils/random";
import { getMap } from "../engine/grid";
import { skirmoraModule } from "./skirmora.module";
import { SkirmoraView } from "./skirmora.projection";
import { DATA_VERSION } from "../engine/version";

const KNIGHTS_ARMY = {
  stacks: [{ unitId: "paladin", count: 2 }, { unitId: "crossbowman", count: 4 }],
  items: { head: "crown" },
  rings: ["ring_sniper"],
};
const BARBARIANS_ARMY = { stacks: [{ unitId: "orc", count: 10 }], items: {}, rings: [] };

function twoPlayers(settings = {}) {
  const game = new GameDriver(["ann", "ben"], { mapId: "arena", ...settings });
  game.act("ann", "pickRace", { raceId: "knights" });
  game.act("ben", "pickRace", { raceId: "barbarians" });
  return game;
}

function toBattle(game: GameDriver) {
  game.act("ann", "submitArmy", KNIGHTS_ARMY);
  game.act("ben", "submitArmy", BARBARIANS_ARMY);
  game.act("ann", "submitDeploy", { placements: [{ stackIndex: 0, x: 1, y: 4 }, { stackIndex: 1, x: 0, y: 5 }] });
  game.act("ben", "submitDeploy", { placements: [{ stackIndex: 0, x: 8, y: 4 }] });
  return game;
}

describe("skirmora module", () => {
  describe("start", () => {
    it("seats players in join order; 2 vs 2 defaults to seats 0+2 vs 1+3", () => {
      const game = new GameDriver(["a", "b", "c", "d"], { mode: "teams", mapId: "river" });
      expect(game.state.seats.map((seat) => [seat.playerId, seat.seat, seat.team])).toEqual([
        ["a", 0, 0],
        ["b", 1, 1],
        ["c", 2, 0],
        ["d", 3, 1],
      ]);
      expect(game.state.phase).toBe("army");
    });

    it("refuses player counts the map or mode doesn't allow", () => {
      const ctx = (players: string[], settings: object) => new GameDriverProbe(players, settings).result();
      expect(ctx(["a", "b", "c"], { mapId: "river" })).toMatchObject({ isSuccess: false, errorStatus: "conflict" });
      expect(ctx(["a", "b", "c"], { mode: "teams" })).toMatchObject({ isSuccess: false });
      expect(ctx(["a", "b", "c"], { mapId: "valley" })).toMatchObject({ isSuccess: true });
    });

    it("validates settings and pins the data version", () => {
      expect(skirmoraModule.settingsSchema.safeParse({ ...skirmoraModule.defaultSettings, budget: 700 }).success).toBe(false);
      expect(skirmoraModule.settingsSchema.safeParse({ ...skirmoraModule.defaultSettings, turnSeconds: 10 }).success).toBe(false);
      const parsed = skirmoraModule.settingsSchema.parse({ ...skirmoraModule.defaultSettings, dataVersion: "hacked" });
      expect(parsed).toEqual({ mapId: "valley", budget: 1000, mode: "ffa", turnSeconds: 45, dataVersion: DATA_VERSION });
    });
  });

  describe("army and deploy phases", () => {
    it("checks armies, names the broken rule, and moves to deploy when everyone is ready", () => {
      const game = twoPlayers();
      expect(game.tryAct("ann", "submitArmy", { stacks: [{ unitId: "orc", count: 1 }] })).toMatchObject({
        errorCode: "invalid-army",
        errorReason: "wrong-race",
      });
      game.act("ann", "submitArmy", KNIGHTS_ARMY);
      expect(game.tryAct("ann", "pickRace", { raceId: "elves" })).toMatchObject({ isSuccess: false });
      game.act("ann", "unready");
      game.act("ann", "submitArmy", KNIGHTS_ARMY);
      expect(game.state.phase).toBe("army");
      game.act("ben", "submitArmy", BARBARIANS_ARMY);
      expect(game.state.phase).toBe("deploy");
    });

    it("hides other armies in the army phase (whole serialized view)", () => {
      const game = twoPlayers();
      game.act("ann", "submitArmy", KNIGHTS_ARMY);
      const benView = JSON.stringify(game.view("ben"));
      for (const secret of ["paladin", "crossbowman", "crown", "ring_sniper"]) expect(benView).not.toContain(secret);
      expect(game.view("ben").seats.find((seat) => seat.playerId === "ann")).toEqual({
        playerId: "ann",
        seat: 0,
        team: null,
        raceId: "knights",
        armyReady: true,
        deployReady: false,
        eliminated: false,
      });
      const annView = game.view("ann");
      expect(annView.mine).toMatchObject({ army: KNIGHTS_ARMY, budget: 1000, gearCap: 300, unitPoints: 660, gearPoints: 95 });
    });

    it("hides deployments (and armies) until the battle starts", () => {
      const game = twoPlayers();
      game.act("ann", "submitArmy", KNIGHTS_ARMY);
      game.act("ben", "submitArmy", BARBARIANS_ARMY);
      game.act("ann", "submitDeploy", { placements: [{ stackIndex: 0, x: 1, y: 4 }, { stackIndex: 1, x: 0, y: 5 }] });
      const benView = game.view("ben");
      const json = JSON.stringify(benView);
      expect(json).not.toContain("stackIndex");
      for (const secret of ["paladin", "crossbowman", "crown"]) expect(json).not.toContain(secret);
      expect(benView.mine!.zone).toHaveLength(20);
      expect(benView.mine!.zone!.every((cell) => cell.x >= 8)).toBe(true);
      expect(game.view("ann").mine!.deployment).toHaveLength(2);
    });

    it("rejects deployments outside the zone or incomplete", () => {
      const game = twoPlayers();
      game.act("ann", "submitArmy", KNIGHTS_ARMY);
      game.act("ben", "submitArmy", BARBARIANS_ARMY);
      expect(game.tryAct("ann", "submitDeploy", { placements: [{ stackIndex: 0, x: 5, y: 4 }, { stackIndex: 1, x: 0, y: 5 }] })).toMatchObject({
        errorCode: "invalid-deploy",
        errorReason: "outside-zone",
      });
      expect(game.tryAct("ann", "submitDeploy", { placements: [{ stackIndex: 0, x: 0, y: 4 }] })).toMatchObject({ errorReason: "missing-stack" });
    });

    it("scout boots make the zone one column deeper", () => {
      const game = twoPlayers();
      game.act("ben", "submitArmy", { ...BARBARIANS_ARMY, items: { feet: "boots_scout" } });
      game.act("ann", "submitArmy", KNIGHTS_ARMY);
      expect(game.view("ben").mine!.zone).toHaveLength(30);
      game.act("ben", "submitDeploy", { placements: [{ stackIndex: 0, x: 7, y: 0 }] });
    });

    it("starts the battle when everyone deployed: random first seat, the deadline, events", () => {
      const game = toBattle(twoPlayers());
      expect(game.state.phase).toBe("battle");
      const view = game.view("ann");
      expect(view.battle!.stacks.map((stack) => [stack.id, stack.unitId, stack.x, stack.y])).toEqual([
        ["s0_0", "paladin", 1, 4],
        ["s0_1", "crossbowman", 0, 5],
        ["s1_0", "orc", 8, 4],
      ]);
      expect(view.battle!.turnDeadline).toBe(new Date(GAME_START + 45_000).toISOString());
      expect(view.events.map((event) => event.type)).toEqual(["battleStarted", "roundStarted", "turnStarted"]);
      expect(game.state.history).toHaveLength(3);
      // gear is public in battle
      expect(view.battle!.sides[0].items).toEqual(["crown", "ring_sniper"]);
    });

    it("2 vs 2: only the host sets teams, teams must stay 2 vs 2", () => {
      const game = new GameDriver(["a", "b", "c", "d"], { mode: "teams", mapId: "river" });
      expect(game.tryAct("b", "setTeam", { playerId: "c", team: 1 })).toMatchObject({ errorStatus: "forbidden" });
      game.act("a", "setTeam", { playerId: "c", team: 1 });
      game.act("a", "pickRace", { raceId: "barbarians" });
      expect(game.tryAct("a", "submitArmy", BARBARIANS_ARMY)).toMatchObject({ errorReason: "unbalanced-teams" });
      game.act("a", "setTeam", { playerId: "b", team: 0 });
      game.act("a", "submitArmy", BARBARIANS_ARMY);
    });
  });

  describe("battle", () => {
    it("hints equal what act accepts", () => {
      const rng = createSeededRng(5);
      for (let round = 0; round < 25; round++) {
        const game = new GameDriver(["a", "b", "c"], { mapId: "graveyard", budget: 1500 }, createSeededRng(100 + round));
        game.randomArmies();
        game.randomDeployments();
        for (let turn = 0; turn < 6 && game.state.phase === "battle"; turn++) {
          const player = game.playerOfSeat(game.state.battle!.activeSeat);
          const view = game.view(player);
          for (const other of game.state.seats.filter((seat) => seat.playerId !== player)) {
            expect(game.view(other.playerId).hints).toBeNull();
          }
          const snapshot = game.state;
          for (const action of actionsFromHints(view.hints!)) {
            const accepted = game.tryAct(player, "act", action);
            expect({ action, ok: accepted.isSuccess }).toEqual({ action, ok: true });
            game.state = snapshot;
            game.finished = false;
          }
          // a sample of cells that aren't hinted moves is refused
          const size = getMap("graveyard").size;
          for (const stack of view.hints!.stacks) {
            const hinted = new Set(stack.moves.map((cell) => `${cell.x},${cell.y}`));
            for (let i = 0; i < 15; i++) {
              const cell = { x: rng.int(size), y: rng.int(size) };
              if (hinted.has(`${cell.x},${cell.y}`)) continue;
              expect(game.tryAct(player, "act", { stackId: stack.stackId, kind: "move", cell })).toMatchObject({ errorCode: "illegal-action" });
            }
            expect(game.tryAct(player, "act", { stackId: stack.stackId, kind: "attack", target: stack.stackId })).toMatchObject({
              errorCode: "illegal-action",
            });
          }
          game.state = snapshot;
          game.randomTurn({ heroChance: 0 });
        }
      }
    });

    it("rejects acting out of turn", () => {
      const game = toBattle(twoPlayers());
      const waiting = game.playerOfSeat(1 - game.state.battle!.activeSeat);
      expect(game.tryAct(waiting, "act", { stackId: "s0_0", kind: "defend" })).toMatchObject({ errorCode: "not-your-turn" });
    });

    it("claimTimeout: too early, then accepted; a second claim is early again; 3 in a row = auto-surrender", () => {
      const game = toBattle(twoPlayers());
      expect(game.tryAct("ann", "claimTimeout")).toMatchObject({ errorCode: "too-early" });
      game.now += 45_000;
      const late = game.state.battle!.activeSeat;
      game.act("ann", "claimTimeout");
      expect(game.state.seats[late].timeoutsInRow).toBe(1);
      expect(game.state.battle!.activeSeat).not.toBe(late);
      expect(game.state.battle!.turnDeadline).toBe(new Date(game.now + 45_000).toISOString());
      expect(game.tryAct("ben", "claimTimeout")).toMatchObject({ errorCode: "too-early" });

      // the seat that timed out times out twice more on its own turns
      for (let i = 0; i < 4 && game.state.phase === "battle"; i++) {
        game.now += 46_000;
        game.act("ann", "claimTimeout");
      }
      expect(game.state.phase).toBe("over");
      expect(game.finished).toBe(false);
      expect(game.state.result!.reason).toBe("surrender");
      expect(game.state.history.some((event) => event.type === "surrendered" && event.reason === "timeout")).toBe(true);
    });

    it("acting resets the timeout counter", () => {
      const game = toBattle(twoPlayers());
      game.now += 45_000;
      const late = game.state.battle!.activeSeat;
      game.act("ann", "claimTimeout");
      // the other seat plays, then the late seat acts
      game.randomTurn({ heroChance: 0 });
      if (game.state.battle!.activeSeat === late) {
        game.randomTurn({ heroChance: 0 });
        expect(game.state.seats[late].timeoutsInRow).toBe(0);
      }
    });

    it("surrender ends a 2-player game", () => {
      const game = toBattle(twoPlayers());
      game.act("ben", "surrender");
      expect(game.state.result).toEqual({ winnerSeats: [0], reason: "surrender" });
      expect(game.finished).toBe(false);
      expect(game.tryAct("ann", "act", { stackId: "s0_0", kind: "defend" })).toMatchObject({ errorStatus: "conflict" });
    });

    it("returns 409 outdated for a session created with other data", () => {
      const game = twoPlayers();
      (game.settings as { dataVersion: string }).dataVersion = "2000.1.0";
      expect(game.tryAct("ann", "submitArmy", KNIGHTS_ARMY)).toMatchObject({ errorCode: "outdated", errorStatus: "conflict" });
    });

    it("plays a 2-player battle to the end through module.actions", () => {
      const game = new GameDriver(["ann", "ben"], { mapId: "valley" }, createSeededRng(77));
      game.randomArmies();
      game.randomDeployments();
      let turns = 0;
      while (game.randomTurn()) turns++;
      expect(game.state.phase).toBe("over");
      expect(game.finished).toBe(false);
      expect(game.state.result!.winnerSeats.length).toBeGreaterThan(0);
      expect(turns).toBeGreaterThan(2);
      expect(game.state.history.at(-1)!.type).toBe("battleOver");
    });

    it("plays a 2 vs 2 battle to the end through module.actions", () => {
      const game = new GameDriver(["a", "b", "c", "d"], { mapId: "pass", mode: "teams" }, createSeededRng(3));
      game.randomArmies();
      game.randomDeployments();
      expect(game.state.battle!.order).toEqual([0, 1, 2, 3]);
      while (game.randomTurn()) {
        // keep going
      }
      expect(game.state.phase).toBe("over");
      expect([[0, 2], [1, 3], [0, 1, 2, 3]]).toContainEqual(game.state.result!.winnerSeats);
    });
  });

  describe("rematch (client plan §15.2)", () => {
    it("the host restarts the army phase in the same room with the same races and armies", () => {
      const game = toBattle(twoPlayers());
      expect(game.tryAct("ann", "rematch")).toMatchObject({ errorStatus: "conflict" });
      game.act("ben", "surrender");
      expect(game.tryAct("ben", "rematch")).toMatchObject({ errorStatus: "forbidden" });
      game.act("ann", "rematch");
      expect(game.state).toMatchObject({ phase: "army", battle: null, result: null, history: [] });
      expect(game.state.seats.map((seat) => [seat.raceId, seat.armyReady, seat.eliminated, seat.deployment])).toEqual([
        ["knights", false, false, null],
        ["barbarians", false, false, null],
      ]);
      expect(game.view("ann").mine!.army).toEqual(KNIGHTS_ARMY);
      // one tap: resubmit the kept army
      game.act("ann", "submitArmy", game.view("ann").mine!.army);
      game.act("ben", "submitArmy", game.view("ben").mine!.army);
      expect(game.state.phase).toBe("deploy");
    });

    it("refuses when the remaining players can't start on this map", () => {
      const game = new GameDriver(["a", "b", "c", "d"], { mode: "teams", mapId: "river" }, createSeededRng(2));
      game.randomArmies();
      game.randomDeployments();
      game.remove("d");
      while (game.state.phase === "battle") game.act(game.playerOfSeat(game.state.battle!.activeSeat), "surrender");
      expect(game.tryAct("a", "rematch")).toMatchObject({ errorStatus: "conflict", error: expect.stringMatching(/new room/) });
    });
  });

  describe("roster changes", () => {
    it("army phase: drops the seat, and ends with fewer than 2 players", () => {
      const game = new GameDriver(["a", "b", "c"], { mapId: "valley" });
      game.act("a", "pickRace", { raceId: "barbarians" });
      game.act("a", "submitArmy", BARBARIANS_ARMY);
      game.act("b", "pickRace", { raceId: "barbarians" });
      game.act("b", "submitArmy", BARBARIANS_ARMY);
      game.remove("c");
      expect(game.state.seats.map((seat) => seat.playerId)).toEqual(["a", "b"]);
      expect(game.state.phase).toBe("deploy");
      game.remove("b");
      expect(game.state.result).toEqual({ winnerSeats: [], reason: "not-enough-players" });
      expect(game.finished).toBe(true);
    });

    it("deploy phase: everyone places again (the zones can change)", () => {
      const game = new GameDriver(["a", "b", "c"], { mapId: "valley" }, createSeededRng(9));
      game.randomArmies();
      const [a] = game.state.seats;
      game.act(a.playerId, "submitDeploy", { placements: game.view("a").mine!.zone!.slice(0, a.army!.stacks.length).map((cell, stackIndex) => ({ stackIndex, ...cell })) });
      game.remove("c");
      expect(game.state.phase).toBe("deploy");
      expect(game.state.seats.every((seat) => !seat.deployReady && seat.deployment === null)).toBe(true);
      expect(game.view("a").mine!.zone).toHaveLength(24); // 2 columns of 12
    });

    it("2 vs 2: an empty team ends the game", () => {
      const game = new GameDriver(["a", "b", "c", "d"], { mode: "teams", mapId: "river" });
      game.remove("b");
      expect(game.state.phase).toBe("army");
      game.remove("d");
      expect(game.state.result!.reason).toBe("not-enough-players");
    });

    it("battle: the seat is eliminated, the turn moves on, the last one standing wins", () => {
      const game = new GameDriver(["a", "b", "c"], { mapId: "valley" }, createSeededRng(11));
      game.randomArmies();
      game.randomDeployments();
      const active = game.playerOfSeat(game.state.battle!.activeSeat);
      game.remove(active);
      const seat = game.state.seats.find((candidate) => candidate.playerId === active)!;
      expect(seat.eliminated).toBe(true);
      expect(game.state.battle!.activeSeat).not.toBe(seat.seat);
      expect(game.state.battle!.stacks.filter((stack) => stack.seat === seat.seat).every((stack) => stack.count === 0)).toBe(true);
      const next = game.state.seats.find((candidate) => !candidate.eliminated)!;
      game.remove(next.playerId);
      expect(game.state.phase).toBe("over");
      expect(game.finished).toBe(false);
    });

    it("over: the room closes when fewer than 2 players are left for a rematch", () => {
      const game = toBattle(twoPlayers());
      game.act("ben", "surrender");
      expect(game.finished).toBe(false);
      game.remove("ben");
      expect(game.state.seats.map((seat) => seat.playerId)).toEqual(["ann"]);
      expect(game.finished).toBe(true);
    });
  });

  describe("projection", () => {
    it("is deterministic and never leaks internal fields", () => {
      const game = new GameDriver(["a", "b"], { mapId: "mill" }, createSeededRng(21));
      game.randomArmies();
      game.randomDeployments();
      for (let i = 0; i < 20 && game.randomTurn(); i++) {
        for (const viewer of ["a", "b"]) {
          const first = JSON.stringify(game.view(viewer));
          expect(JSON.stringify(game.view(viewer))).toBe(first);
          for (const hidden of ["killedThisRound", "nextSeq", "timeoutsInRow", "tokenHash", "\"army\":", "\"deployment\":", "activations"]) {
            expect(first).not.toContain(hidden);
          }
        }
      }
    });

    it("an outsider gets the public view only", () => {
      const game = toBattle(twoPlayers());
      const view: SkirmoraView = game.view("stranger");
      expect(view.mySeat).toBeNull();
      expect(view.hints).toBeNull();
      expect(view.mine).toBeNull();
    });
  });

  describe("through the session pipeline", () => {
    it("routes skirmora.* actions and refuses joins after the start", async () => {
      const h = createHttpHarness({ module: skirmoraModule });
      const host = await h.api.createPlayer("Ann", { settings: { mapId: "arena" } });
      const ben = await h.api.joinPlayer(host.code, "Ben");
      let view = await h.api.act(host, "lobby.start");
      expect(view.settings).toMatchObject({ mapId: "arena", allowJoinInProgress: false, maxPlayers: 4, dataVersion: DATA_VERSION });
      expect((view.game as SkirmoraView).phase).toBe("army");
      const late = await h.api.join(host.code, { nickname: "Cid" });
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe("session-started");

      view = await h.api.act(ben, "skirmora.pickRace", { raceId: "elves" });
      expect((view.game as SkirmoraView).seats[1].raceId).toBe("elves");
      const bad = await h.api.action(ben, "skirmora.submitArmy", { stacks: [{ unitId: "orc", count: 1 }] });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatchObject({ code: "invalid-army", reason: "wrong-race" });
      expect((await h.api.action(ben, "test-game.increment")).status).toBe(400);
      expect((await h.api.history(ben)).body).toEqual([]);
    });
  });
});

/** createInitialState without throwing, for the player-count checks. */
class GameDriverProbe {
  constructor(private readonly players: string[], private readonly settings: object) {}
  result() {
    try {
      new GameDriver(this.players, this.settings);
      return { isSuccess: true };
    } catch (error) {
      return { isSuccess: false, errorStatus: "conflict", error: String(error) };
    }
  }
}

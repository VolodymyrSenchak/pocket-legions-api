import { describe, expect, it } from "vitest";
import { RACE_IDS } from "../engine/data/races";
import { getMap } from "../engine/grid";
import { DATA_VERSION } from "../engine/version";
import { SessionView } from "../models";
import { randomArmy } from "../testing/fuzz";
import { actionsFromHints } from "../testing/game";
import { createHttpHarness, TestPlayer } from "../testing/harness";
import { createSeededRng } from "../utils/random";
import { pocketLegionsModule } from "./pocketLegions.module";
import type { PocketLegionsView } from "./pocketLegions.projection";

// Plan Phase 4: the whole game over HTTP (`/actions` + `/state`) on the in-memory repository with a seeded rng.

const gameOf = (view: SessionView) => view.game as PocketLegionsView;

async function lobby(h: ReturnType<typeof createHttpHarness>, names: string[], settings: Record<string, unknown>) {
  const host = await h.api.createPlayer(names[0], { settings });
  const players: TestPlayer[] = [host];
  for (const name of names.slice(1)) players.push(await h.api.joinPlayer(host.code, name));
  await h.api.act(host, "lobby.start");
  return players;
}

describe("pocket-legions over HTTP", () => {
  it("2 players: create, join, start, armies, deploy and a battle to the end", async () => {
    const h = createHttpHarness({ module: pocketLegionsModule });
    const pick = createSeededRng(8);
    const players = await lobby(h, ["Ann", "Ben"], { mapId: "valley", budget: 1000, turnSeconds: 30 });
    const map = getMap("valley");

    const info = await h.api.info(players[0].code);
    expect(info.body).toMatchObject({ status: "in_progress", joinable: false, mapId: "valley", mode: "ffa", budget: 1000 });

    for (const player of players) {
      const raceId = pick.pick(RACE_IDS);
      await h.api.act(player, "pocket-legions.pickRace", { raceId });
      await h.api.act(player, "pocket-legions.submitArmy", randomArmy(pick, raceId, { budget: 1000, mapSize: map.size, playerCount: 2 }));
    }
    for (const player of players) {
      const mine = gameOf(await h.api.view(player)).mine!;
      const placements = mine.zone!.slice(0, mine.army!.stacks.length).map((cell, stackIndex) => ({ stackIndex, ...cell }));
      await h.api.act(player, "pocket-legions.submitDeploy", { placements });
    }

    let view = await h.api.view(players[0]);
    expect(gameOf(view).phase).toBe("battle");
    let lastSeq = 0;
    for (let step = 0; gameOf(view).phase === "battle"; step++) {
      if (step > 2000) throw new Error("the battle did not end");
      const battle = gameOf(view).battle!;
      const active = players.find((player) => gameOf(view).seats.find((seat) => seat.playerId === player.playerId)!.seat === battle.activeSeat)!;
      const waiting = players.find((player) => player !== active)!;
      expect(gameOf(await h.api.view(waiting)).hints).toBeNull();
      // now and then the turn times out instead
      if (step % 17 === 16) {
        h.advance(31_000);
        view = await h.api.act(waiting, "pocket-legions.claimTimeout");
      } else {
        const hints = gameOf(await h.api.view(active)).hints!;
        view = await h.api.act(active, "pocket-legions.act", pick.pick(actionsFromHints(hints)));
      }
      const seqs = gameOf(view).events.map((event) => event.seq);
      expect(seqs.at(-1)!).toBeGreaterThan(lastSeq);
      lastSeq = seqs.at(-1)!;
    }
    expect(view.status).toBe("finished");
    expect(gameOf(view).phase).toBe("over");
    expect(gameOf(view).result!.winnerSeats.length).toBeGreaterThan(0);

    const history = await h.api.history(players[1]);
    expect(history.status).toBe(200);
    expect(history.body[0].type).toBe("battleStarted");
    expect(history.body.at(-1).type).toBe("battleOver");
    expect((await h.api.action(players[0], "pocket-legions.surrender")).status).toBe(409);
  });

  it("4 simultaneous submitArmy calls with write conflicts lose nothing", async () => {
    const h = createHttpHarness({ module: pocketLegionsModule, repositoryLatencyMs: 2 });
    const players = await lobby(h, ["A", "B", "C", "D"], { mapId: "graveyard" });
    for (const player of players) await h.api.act(player, "pocket-legions.pickRace", { raceId: "barbarians" });

    h.repository.forceConflicts(3);
    const results = await Promise.all(
      players.map((player) => h.api.action(player, "pocket-legions.submitArmy", { stacks: [{ unitId: "orc", count: 10 }] }))
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    const view = gameOf(await h.api.view(players[0]));
    expect(view.seats.every((seat) => seat.armyReady)).toBe(true);
    expect(view.phase).toBe("deploy");
  });

  it("answers 409 outdated for a session made with other game data, and lists the map in /info", async () => {
    const h = createHttpHarness({ module: pocketLegionsModule });
    const [ann, ben] = await lobby(h, ["Ann", "Ben"], { mapId: "arena", mode: "ffa", budget: 500 });
    expect((await h.api.info(ann.code)).body).toMatchObject({ mapId: "arena", mode: "ffa", budget: 500 });
    const view = await h.api.view(ann);
    expect(view.settings).toMatchObject({ dataVersion: DATA_VERSION });

    const row = h.repository.getAll()[0];
    await h.repository.compareAndSwap(row.id, row.version, {
      status: row.status,
      hostPlayerId: row.hostPlayerId,
      state: { ...row.state, settings: { ...row.state.settings, dataVersion: "1999.1.0" } },
    });
    for (const [player, type] of [[ann, "pocket-legions.pickRace"], [ben, "lobby.leave"]] as const) {
      const res = await h.api.action(player, type, { raceId: "elves" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("outdated");
    }
    // the state stays readable so the client can show "The game was updated"
    expect((await h.api.state(ann)).status).toBe(200);
  });

  it("refuses to start with a player count the map doesn't allow", async () => {
    const h = createHttpHarness({ module: pocketLegionsModule });
    const host = await h.api.createPlayer("Ann", { settings: { mapId: "river" } });
    await h.api.joinPlayer(host.code, "Ben");
    await h.api.joinPlayer(host.code, "Cid");
    const res = await h.api.action(host, "lobby.start");
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/2 players/);
    expect((await h.api.create({ nickname: "Al", settings: { budget: 750 } })).status).toBe(400);
    expect((await h.api.create({ nickname: "Al", settings: { maxPlayers: 5 } })).status).toBe(400);
  });
});

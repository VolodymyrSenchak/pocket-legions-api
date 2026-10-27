import { afterEach, describe, expect, it } from "vitest";
import { SessionView } from "../models";
import { actionsFromHints } from "../testing/game";
import { Cluster, createCluster, TestClient } from "../testing/cluster";
import { createSeededRng } from "../utils/random";
import { pocketLegionsModule } from "./pocketLegions.module";
import type { PocketLegionsView } from "./pocketLegions.projection";

// Plan Phase 5: two servers sharing an in-memory bus.

const gameOf = (view: SessionView) => view.game as PocketLegionsView | null;
const SECRET_ARMY = { stacks: [{ unitId: "angel", count: 1 }, { unitId: "paladin", count: 2 }], items: { neck: "clover" }, rings: [] };
const OTHER_ARMY = { stacks: [{ unitId: "goblin", count: 20 }], items: {}, rings: [] };

async function ack(client: TestClient, type: string, payload?: unknown): Promise<SessionView> {
  const response = await client.action(type, payload);
  if (!response.ok) throw new Error(`${type}: ${response.error.code} ${response.error.message}`);
  return response.session;
}

/** Ann on instance A, Ben on instance B, both through armies and deployment. */
async function toBattle(cluster: Cluster, check?: (ann: TestClient, ben: TestClient) => void) {
  const [annPlayer, benPlayer] = await cluster.lobby(["Ann", "Ben"], { mapId: "arena" });
  const ann = await cluster.connect(cluster.a, annPlayer);
  const ben = await cluster.connect(cluster.b, benPlayer);
  await ack(ann, "lobby.start");
  await ack(ann, "pocket-legions.pickRace", { raceId: "knights" });
  await ack(ben, "pocket-legions.pickRace", { raceId: "barbarians" });
  await ack(ann, "pocket-legions.submitArmy", SECRET_ARMY);
  await ack(ben, "pocket-legions.submitArmy", OTHER_ARMY);
  await ack(ann, "pocket-legions.submitDeploy", { placements: [{ stackIndex: 0, x: 0, y: 4 }, { stackIndex: 1, x: 1, y: 6 }] });
  await ben.waitForState((view) => gameOf(view)?.seats[0].deployReady === true, "Ann deployed");
  check?.(ann, ben);
  await ack(ben, "pocket-legions.submitDeploy", { placements: [{ stackIndex: 0, x: 9, y: 4 }] });
  await Promise.all([ann, ben].map((client) => client.waitForState((view) => gameOf(view)?.phase === "battle", "battle")));
  return { ann, ben };
}

describe("pocket-legions realtime (two instances)", () => {
  let cluster: Cluster;

  afterEach(async () => {
    await cluster?.close();
  });

  it("no payload to Ben carries Ann's army or deployment before the battle", async () => {
    cluster = await createCluster({ module: pocketLegionsModule });
    const { ben } = await toBattle(cluster, (_ann, benBefore) => {
      const traffic = JSON.stringify(benBefore.events);
      for (const secret of ["angel", "paladin", "clover", "stackIndex"]) expect(traffic).not.toContain(secret);
    });
    const battle = gameOf(ben.latest)!.battle!;
    expect(battle.stacks.map((stack) => stack.unitId)).toEqual(["angel", "paladin", "goblin"]);
  });

  it("an act on instance A reaches the client on instance B with its events in order", async () => {
    cluster = await createCluster({ module: pocketLegionsModule });
    const { ann, ben } = await toBattle(cluster);
    const clients = { 0: ann, 1: ben } as Record<number, TestClient>;
    const rng = createSeededRng(4);
    for (let turn = 0; turn < 6 && gameOf(ann.latest)!.phase === "battle"; turn++) {
      const active = clients[gameOf(ann.latest)!.battle!.activeSeat];
      const watcher = active === ann ? ben : ann;
      const hints = gameOf(active.latest)!.hints!;
      const after = await ack(active, "pocket-legions.act", rng.pick(actionsFromHints(hints)));
      const seen = await watcher.waitForState((view) => view.version === after.version, "the act");
      expect(gameOf(seen)!.events).toEqual(gameOf(after)!.events);
      await active.waitForState((view) => view.version === after.version, "own push");
    }
    // every state Ben got had strictly increasing event numbers
    let last = 0;
    for (const view of ben.states) {
      for (const event of gameOf(view)?.events ?? []) {
        if (event.seq > last) last = event.seq;
      }
      const seqs = (gameOf(view)?.events ?? []).map((event) => event.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    }
    expect(last).toBeGreaterThan(3);
  });

  it("two claimTimeouts on different instances: exactly one is applied", async () => {
    cluster = await createCluster({ module: pocketLegionsModule });
    const { ann, ben } = await toBattle(cluster);
    const deadline = Date.parse(gameOf(ann.latest)!.battle!.turnDeadline);
    cluster.setClockOffset(deadline - Date.now() + 1000);
    const acks = await Promise.all([ann.action("pocket-legions.claimTimeout"), ben.action("pocket-legions.claimTimeout")]);
    expect(acks.filter((response) => response.ok)).toHaveLength(1);
    // the loser re-runs on the new state, whose deadline lies ahead
    expect(acks.find((response) => !response.ok)).toMatchObject({ ok: false, error: { code: "too-early" } });
    const history = await cluster.api.history({ ...ann.player });
    expect(history.body.filter((event: { type: string }) => event.type === "timedOut")).toHaveLength(1);
  });

  it("refuses the socket of a session made with other game data", async () => {
    cluster = await createCluster({ module: pocketLegionsModule });
    const [annPlayer] = await cluster.lobby(["Ann", "Ben"], { mapId: "arena" });
    const { repository } = cluster;
    const row = (await repository.findLiveByCode(annPlayer.code)).result!;
    await repository.compareAndSwap(row.id, row.version, {
      status: row.status,
      hostPlayerId: row.hostPlayerId,
      state: { ...row.state, settings: { ...row.state.settings, dataVersion: "1999.1.0" } },
    });
    await expect(cluster.client(cluster.b, annPlayer).connect()).rejects.toMatchObject({ data: { code: "outdated" } });
  });
});

# Pocket Legions API — contract for the client

The server is the authority on every rule. The client sends intents and renders the snapshot (`SessionView`) it gets for its own player. This file covers what the client needs: endpoints, socket events, client rules and example views. The reasoning is in [pocket-legions.api.implementation-plan.md](pocket-legions.api.implementation-plan.md) (§3, §7, §9). The infrastructure is the same as sen-reveal-api ("SR §9").

Types live in the repo and the client copies them with `engine/` and `game/`:
- `PocketLegionsView`, `SeatView`, `BattleView`, `StackView`, `MyArmyView` — `src/game/pocketLegions.projection.ts`
- `Hints` — `src/game/pocketLegions.hints.ts`
- `GameEvent`, `Status` — `src/engine/state.ts`
- unit, item and map ids — `src/engine/data/*`

## 1. HTTP (`/api/sessions`)

Player endpoints need the `X-Player-Token` header. Errors: `{ error: { code, message, reason? } }`.

| Method & path | Body | Response |
|---|---|---|
| `POST /api/sessions` | `{ nickname, password?, settings?: { mapId, budget, mode, turnSeconds, maxPlayers } }` | `201 { playerId, playerToken, session }` / `400` bad settings |
| `GET /api/sessions/:code/info` | — | `{ code, status, requiresPassword, playerCount, maxPlayers, joinable, expiresAt, mapId, mode, budget }` |
| `POST /api/sessions/:code/join` | `{ nickname, password? }` | `{ playerId, playerToken, session }` / `401` wrong password / `404` / `409 session-started \| session-full \| session-finished \| nickname-taken` / `410` |
| `GET /api/sessions/:code/state` | — (+ `If-None-Match`) | `200 SessionView` + `ETag` / `304` / `401` / `403 kicked \| left` / `404` / `410` |
| `POST /api/sessions/:code/actions` | `{ type, payload }` | `SessionView` after the action |
| `GET /api/sessions/:code/history` | — | `GameEvent[]`, the full battle log (last 3000) |

Settings (validated on create, defaults in brackets):
- `mapId`: `arena`, `valley`, `mill`, `river`, `graveyard`, `lava`, `pass`, `village` (`valley`);
- `budget`: `500 | 1000 | 1500 | 2000` (`1000`);
- `mode`: `ffa | teams` (`ffa`);
- `turnSeconds`: 30–90 (`45`);
- `maxPlayers`: 2–4 (`4`).

`dataVersion` is set by the server, and `allowJoinInProgress` is always `false`. `lobby.start` checks the player count: on `river` and `pass` FFA is for 2 players only, and `teams` needs exactly 4.

## 2. Actions

`lobby.*`: `start`, `kick`, `transferHost`, `leave`, `end` (as in SR), plus `updateSettings`: host only, before the start, payload = any subset of the create settings. It returns `400` for bad values and `409` once started or if `maxPlayers` is below the players already in. Game actions are `pocket-legions.<name>`. They need `status === 'in_progress'`, otherwise you get `409 conflict`.

| Action | Phase | Who | Payload | Errors |
|---|---|---|---|---|
| `pickRace` | army | own seat, not ready | `{ raceId }` | `409` when ready |
| `setTeam` | army | host, `teams` only | `{ playerId, team: 0 \| 1 }` | `403`, `404` |
| `submitArmy` | army | own seat | `{ stacks: { unitId, count }[], items: { head?, neck?, body?, cloak?, weapon?, shield?, feet? }, rings: ItemId[] }` | `400 invalid-army` + `reason`; `409` + `reason: unbalanced-teams` |
| `unready` | army, deploy | own seat | `{}` | |
| `submitDeploy` | deploy | own seat | `{ placements: { stackIndex, x, y }[] }` (indexes into your `stacks`) | `400 invalid-deploy` + `reason` |
| `act` | battle | active seat | `{ stackId, kind: 'move' \| 'attack' \| 'shoot' \| 'ability' \| 'defend', cell?, target? }` | `409 not-your-turn`, `400 illegal-action` + `reason` |
| `heroAbility` | battle | active seat, before `act` | `{ target?, ally?, cell?, cells? }` | same as `act` |
| `claimTimeout` | battle | any seat | `{}` | `409 too-early` |
| `surrender` | battle | own seat | `{}` | |
| `rematch` | over | host | `{}` | `403`; `409` if the players left can't start on this map |

`act` fields per kind:
- `move`: `cell` is the destination.
- `attack`: `target`, plus `cell` = the cell to attack from (or, for the gyrocopter, the cell to land on). Without `cell` the stack attacks from where it stands.
- `shoot`: `target`.
- `ability`: `target` (an ally; none for the banshee scream), plus an optional `cell` to move to first.

`heroAbility` payload per hero:

| Hero ability | Payload |
|---|---|
| `heavenly_shield` | `{ target: allyStackId }` |
| `blood_ritual` | `{ target: enemyStackId, ally: ownStackId }` |
| `earth_roots` | `{ target: enemyStackId }` |
| `battle_cry` | `{}` |
| `hellfire` | `{ cell }` (centre of the 3×3) |
| `stone_wall` | `{ cells: [3 free cells in a straight line] }` |

`reason` values:
- `invalid-army`: `no-race`, `no-stacks`, `too-many-stacks`, `unknown-unit`, `wrong-race`, `bad-count`, `too-many-of-type`, `too-many-champions`, `unknown-item`, `wrong-slot`, `too-many-rings`, `gear-over-cap`, `over-budget`.
- `invalid-deploy`: `missing-stack`, `duplicate-stack`, `outside-zone`, `cell-blocked`, `cell-taken`.
- `illegal-action`: for example `stack-cannot-act`, `unreachable-cell`, `bad-target`, `bad-attack-cell`, `no-targets`, `hero-unavailable`, `bad-cells`, `battle-over`.

Any action (and the socket handshake) on a session created with other game data returns `409 outdated`.

## 3. Socket.IO

Same as SR §9.2. Connect with `io(API_URL, { path: '/socket.io', transports: ['websocket'], auth: { code, playerToken } })`. On a bad connect you get `connect_error` with `data.code` one of `not-found | unauthorized | kicked | left | gone | outdated`.

| Direction | Event | Payload |
|---|---|---|
| S → C | `session:state` | `SessionView` for this player, on connect and after every change |
| S → C | `session:expired` | `{ expiresAt }`, then disconnect |
| S → C | `session:idle` | `{}`, then disconnect |
| S → C | `player:removed` | `{ reason: 'kicked' \| 'left' \| 'replaced' }`, then disconnect |
| C → S | `action` | `{ type, payload }`, ack `{ ok: true, session } \| { ok: false, error: { code, message, reason? } }` |

Limits: the action payload is at most 32 KB, 30 actions per 10 s per socket, and HTTP `/state` + `/actions` at most 300/min per IP.

## 4. Client rules

SR §9.3 applies as is: store the token, reconnect, accept a snapshot only if `version` ≥ yours, fall back to polling. On top of that:
1. **Animations.** Animate `game.events` whose `seq > lastAnimatedSeq`, in order. If the first event of a snapshot is newer than `lastAnimatedSeq + 1` (a gap after a reconnect), skip the animation, render the state, and set `lastAnimatedSeq` to the last `seq`.
2. **Turn timer.** Show the countdown from `battle.turnDeadline` against your own clock. When your clock passes `turnDeadline + 1 s`, send `pocket-legions.claimTimeout` once, from any seat. Ignore `too-early` and `conflict`. Three timeouts in a row of one seat mean it surrenders automatically.
3. **Moves.** Offer only what `game.hints` offers. Hints are present only for the active seat. `attacks[].from` lists the cells to attack from, and `preview` is computed for `from[0]`. `shots[].penalty` explains a halved shot.
4. **Morale.** `battle.bonusStackId` set means that stack acts once more (the hints then contain only it).
5. **Versions.** On `409 outdated` show "The game was updated — start a new room". If `settings.dataVersion` differs from the client's synced `DATA_VERSION`, prompt a reload before acting.
6. **Hidden information.** You never see other players' armies, gear or deployments before the battle. Gear (`battle.sides[].items`) becomes visible when the battle starts.
7. **After the battle** (`phase: over`) the session stays `in_progress`. Show the result with "Rematch" for the host and "Leave" for everyone.
8. **Dead stacks** stay in `battle.stacks` with `count: 0` (corpses). Their cell is free.

## 5. Event types

Every event has `seq` and `round`. The other fields depend on `type`:

| `type` | Fields |
|---|---|
| `battleStarted`, `roundStarted`, `turnStarted` | `seat` |
| `moved` | `stackId`, `path` |
| `attacked`, `shot` | `stackId`, `targetId` |
| `damaged` | `stackId` (victim), `targetId` (source), `amount`, `kills`, `detail?` (`retaliation`, `splash`, `burn`, `reflect`, `lightning`, `hero`) |
| `missed` | `stackId` (dodged), `targetId` (attacker) |
| `retaliated` | `stackId`, `targetId` |
| `abilityUsed` | `stackId`, `abilityId`, `targetId?` |
| `heroAbility` | `seat`, `abilityId`, `targetId?`, `cell?` |
| `healed`, `resurrected` | `stackId`, `amount` (HP), `abilityId` |
| `raised` | `stackId` (skeletons), `amount` (units) |
| `statusApplied` | `stackId`, `statusId`, `targetId?` (source) |
| `skipped` | `stackId`, `detail?` (`stun`, `fear`, `blind`) |
| `defended` | `stackId` |
| `stackDied` | `stackId`, `seat`, `cell` |
| `morale` | `stackId`, `detail`: `again` \| `skip` |
| `luck` | `stackId`, `detail`: `double` \| `half` \| `critical` |
| `wallBuilt` | `seat`, `cells` |
| `timedOut` | `seat` |
| `surrendered`, `playerEliminated` | `seat`, `reason` (`surrender`, `timeout`, `left`, `defeated`) |
| `battleOver` | `winnerSeats`, `reason` (`elimination`, `round-limit`, `surrender`), `points?` |

Statuses (`StackView.statuses[].id`):
- `defending`, `skip_next`, `blinded`, `entangled`, `maimed`, `diseased`, `burning`;
- `war_drum`, `rune_shield`, `scream`, `heavenly_shield`, `battle_cry`.

`untilRound` means the status ends with that round, and `untilActivation` means it ends with that activation of the stack.

## 6. Example views

These come from a real run (Ann plays knights, Ben plays barbarians, on Arena), shortened with `…`.

### 6.1 A whole `SessionView`, army phase (Ben's view, Ann is ready)

```json
{
  "code": "601103", "status": "in_progress", "version": 6,
  "createdAt": "2026-09-01T12:00:00.000Z", "expiresAt": "2026-09-02T12:00:00.000Z",
  "hostPlayerId": "eba3f573-…",
  "me": { "playerId": "4d5d9b61-…", "nickname": "Ben", "isHost": false },
  "players": [
    { "id": "eba3f573-…", "nickname": "Ann", "isHost": true, "isOnline": true, "joinedAt": "2026-09-01T12:00:00.000Z" },
    { "id": "4d5d9b61-…", "nickname": "Ben", "isHost": false, "isOnline": true, "joinedAt": "2026-09-01T12:00:00.000Z" }
  ],
  "settings": { "mapId": "arena", "budget": 1000, "mode": "ffa", "turnSeconds": 45, "dataVersion": "2026.11.0", "maxPlayers": 4, "allowJoinInProgress": false },
  "poll": { "intervalMs": 1500 },
  "game": {
    "phase": "army", "mapId": "arena", "mode": "ffa", "budget": 1000, "turnSeconds": 45, "dataVersion": "2026.11.0",
    "seats": [
      { "playerId": "eba3f573-…", "seat": 0, "team": null, "raceId": "knights", "armyReady": true, "deployReady": false, "eliminated": false },
      { "playerId": "4d5d9b61-…", "seat": 1, "team": null, "raceId": "barbarians", "armyReady": false, "deployReady": false, "eliminated": false }
    ],
    "mySeat": 1,
    "mine": { "army": null, "budget": 1000, "gearCap": 300, "unitPoints": 0, "gearPoints": 0, "zone": null, "deployment": null },
    "battle": null, "hints": null, "events": [], "result": null
  }
}
```

Ann's army is not in Ben's view. Only `raceId` and `armyReady` are.

### 6.2 Deploy phase (`game.mine` of Ben, Ann already placed her stacks)

```json
{
  "army": { "stacks": [{ "unitId": "orc", "count": 8 }, { "unitId": "wolf_rider", "count": 6 }], "items": {}, "rings": ["ring_str"] },
  "budget": 1000, "gearCap": 300, "unitPoints": 810, "gearPoints": 25,
  "zone": [{ "x": 8, "y": 0 }, { "x": 9, "y": 0 }, { "x": 8, "y": 1 }, "… 17 more"],
  "deployment": null
}
```

### 6.3 Battle, as the active player (Ann)

```json
{
  "phase": "battle", "mySeat": 0,
  "battle": {
    "round": 1, "order": [0, 1], "firstSeat": 0, "activeSeat": 0, "turn": 1,
    "turnDeadline": "2026-09-01T12:00:45.000Z", "bonusStackId": null,
    "sides": [
      { "seat": 0, "team": null, "raceId": "knights", "items": ["helm_luck"] },
      { "seat": 1, "team": null, "raceId": "barbarians", "items": ["ring_str"] }
    ],
    "stacks": [
      { "id": "s0_0", "seat": 0, "unitId": "swordsman", "count": 6, "hpTop": 13, "startCount": 6, "x": 1, "y": 4, "shots": 0, "retaliationsLeft": 1, "activated": false, "statuses": [], "rage": 0, "resurrectUsed": false },
      { "id": "s0_1", "seat": 0, "unitId": "archer", "count": 4, "hpTop": 7, "startCount": 4, "x": 0, "y": 5, "shots": 10, "retaliationsLeft": 1, "activated": false, "statuses": [], "rage": 0, "resurrectUsed": false },
      { "id": "s1_0", "seat": 1, "unitId": "orc", "count": 8, "hpTop": 16, "startCount": 8, "x": 8, "y": 4, "…": "…" },
      { "id": "s1_1", "seat": 1, "unitId": "wolf_rider", "count": 6, "hpTop": 11, "startCount": 6, "x": 9, "y": 6, "…": "…" }
    ],
    "heroes": [
      { "seat": 0, "abilityId": "heavenly_shield", "usesLeft": 2, "readyRound": 1, "usedThisTurn": false },
      { "seat": 1, "abilityId": "battle_cry", "usesLeft": 2, "readyRound": 1, "usedThisTurn": false }
    ],
    "walls": []
  },
  "hints": {
    "stacks": [
      { "stackId": "s0_0", "moves": [{ "x": 0, "y": 3 }, { "x": 1, "y": 3 }, { "x": 0, "y": 4 }, "… 33 more"], "attacks": [], "shots": [], "abilities": [], "canDefend": true },
      { "stackId": "s0_1", "moves": ["…"], "attacks": [],
        "shots": [{ "targetId": "s1_0", "penalty": ["range"], "preview": { "dmg": [3, 9], "kills": [0, 0] } }],
        "abilities": [], "canDefend": true }
    ],
    "hero": { "abilityId": "heavenly_shield", "targets": ["s0_0", "s0_1"], "allies": [], "cells": [] }
  },
  "events": [
    { "seq": 1, "round": 1, "type": "battleStarted", "seat": 0 },
    { "seq": 2, "round": 1, "type": "roundStarted", "seat": 0 },
    { "seq": 3, "round": 1, "type": "turnStarted", "seat": 0 }
  ]
}
```

The `s0_1` shot hint is illustrative. A melee hint has the same shape: `{ "targetId": "s1_0", "from": [{ "x": 7, "y": 4 }], "preview": { "dmg": [10, 15], "kills": [0, 0] } }`.

### 6.4 Battle, as the waiting player (Ben)

The same `battle` and `events`, with `"mySeat": 1` and `"hints": null`.

### 6.5 Over (Ben surrendered)

```json
{
  "phase": "over",
  "result": { "winnerSeats": [0], "reason": "surrender" },
  "events": [
    { "seq": 4, "round": 1, "type": "surrendered", "seat": 1, "reason": "surrender" },
    { "seq": 5, "round": 1, "type": "playerEliminated", "seat": 1, "reason": "surrender" },
    { "seq": 6, "round": 1, "type": "battleOver", "winnerSeats": [0], "reason": "surrender" }
  ]
}
```

The session stays `in_progress` so the host can send `pocket-legions.rematch`: the game goes back to `army` with everyone's race and army kept in `mine.army` (resubmit it to be ready). The session finishes with `lobby.end` or when fewer than 2 players are left. The final `battle.stacks` are kept, and after the round limit `result.points` holds the living army points per seat in `battle.order`.

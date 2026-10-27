# Pocket Legions API — Implementation Plan

Source requirements: [pocket-legions.game-design.md](../../../design/pocket-legions.game-design.md) (a snapshot of the live design doc, https://claude.ai/artifact/YGKQ9ovR88U6e6LiBNWTBA; the live doc wins if they differ).
Reference implementation: [sen-reveal-api](../../../../../sen-reveal/sen-reveal-api/README.md) and its [implementation plan](../../../../../sen-reveal/sen-reveal-api/docs/implementation/sen-reveal.api.implementation-plan.md). This plan reuses its sections by number (for example "SR §3.4") and only spells out what differs.
Client: [pocket-legions.app.implementation-plan.md](../../../pocket-legions-app/docs/implementation/pocket-legions.app.implementation-plan.md).

This plan covers the backend (HTTP + WebSocket API) for Pocket Legions: a turn-based tactics game for 2–4 players. Each player picks a race and buys an army and hero gear from a fixed budget. Then the players deploy on a grid map and fight until one side is left.

**Confirmed decisions**
- **A separate repo, `pocket-legions-api`.** It is *not* a module inside sen-reveal-api. It copies sen-reveal-api's architecture and infrastructure code (§5), and keeps the copied files close to the originals so fixes can be ported between the two repos.
- Hosting: **Vercel**. Real-time sync uses **Vercel Functions WebSockets** (public beta) with Socket.IO, with **HTTP short polling as a fallback** (SR §3.1).
- **Supabase is only the database**: one table plus a presence RPC. Supabase Realtime is used only as a server-to-server relay (SR §3.2). Clients never talk to Supabase.
- **The server is the authority** on every rule. Clients send intents and render per-player projected snapshots (SR §3.5).
- **The engine is pure TypeScript** in `src/engine` and `src/game`, with no Node, DB or socket imports. The client copies these two folders for hot-seat play and move hints (§3.3).
- 2–4 players. Modes: free-for-all and 2 vs 2. **No joining after `lobby.start`.**
- Randomness comes from the server's `ctx.rng` (crypto). No seed is stored, so nobody can predict a roll (§3.2).
- Battle events (moves, hits, deaths) travel **inside the snapshot** as a capped, numbered list. They are never pushed separately, so SR's "snapshots only" rule holds (§3.4).
- Turn timer without any background job: the state stores a deadline, and any client may send `pocket-legions.claimTimeout` after it passes (§3.5).
- Table `pocket_legions_session`. As in sen-reveal, **the owner creates the DB objects manually** (§4.1). It may live in the same Supabase project as sen-reveal.
- Vercel plan: **Hobby** (same limits as SR §12.1; quotas are probably per account and therefore shared with sen-reveal, which needs checking).

---

## 1. Starting point

| Area | State | Action |
|---|---|---|
| Repo | Empty. This folder holds only docs | Phase 0 scaffolds it by copying from sen-reveal-api |
| Reference | sen-reveal-api at commit `83a5261`: Phases 0–5 built, 56 tests, three game modules | Copy the infrastructure listed in §5. Record the source commit in the README so later fixes can be diffed |
| Game data | `design/data/gamedata.js` (races, units, abilities, heroes, items) and `design/data/maps.js` (8 maps, symmetry builder, validator) in plain JS. `design/tools/build.js` computes unit costs from stats | Port to TypeScript in Phase 1. Costs are copied from the build output, and a test recomputes them (§6.1) |
| Art | `design/art/` (gallery, SVG sprite renderer) | Client only. Not part of the API |
| Supabase | The sen-reveal project exists. `pocket_legions_session` does not | Owner creates the objects from §4.1 before Phase 4 |

---

## 2. Scope

### In scope (MVP)
- Anonymous players, a 6-digit room code with an optional password, and a lobby (join, leave, kick, host transfer, start). All of this is copied from sen-reveal.
- Session settings: map, budget (500 / 1000 / 1500 / 2000), mode (FFA / 2v2), turn length.
- Game phases: **army** (pick race, team in 2v2, buy stacks and hero gear) → **deploy** (place stacks in your zone, hidden until everyone is ready) → **battle** → **over**.
- Full combat rules from design §3: alternating activation, movement, melee with retaliation, shooting with range, adjacency and line-of-sight rules, luck, morale, defend.
- 6 races × 10 units with 39 abilities (design §5–6), 6 heroes with an active ability, 26 gear items (design §7), and 8 maps (design §8).
- A per-player projection with move/attack hints and damage previews for the active player, plus the battle event list for animations.
- Turn timer, surrender, leaving mid-battle, a 30-round limit with points scoring, presence, 24 h expiry, and the polling fallback.

### Out of scope (for now)
- The UI (separate repo, separate plan).
- Hot-seat (one phone) mode. It runs entirely in the client on the copied engine, and the API only has to keep `engine/` and `game/` pure.
- Accounts, ratings, stats across sessions, spectators, replays, AI opponents, purchases.

---

## 3. Architecture decisions

### 3.1 Inherited unchanged from sen-reveal
| SR section | Topic | Delta for Pocket Legions |
|---|---|---|
| §3.1 | WebSockets on Vercel + polling fallback, 300 s connection lifetime | A battle lasts 10–25 min, so expect 2–5 planned reconnects per battle. The 20 min idle disconnect can't fire mid-battle because the turn timer keeps the session changing |
| §3.2 | Supabase Realtime Broadcast as a server-only relay | Topic `pocket-legions-session:<sessionId>` |
| §3.3 | One row per session, `state jsonb` | Bigger state than sen-reveal. Static data (map obstacles, unit stats) is never stored, only ids. The event list in `state` is capped (§3.4). Target: well under 100 KB per row |
| §3.4 | Optimistic locking (`version`, compare-and-swap, 10 jittered retries) | In battle only the active player acts, so conflicts come mostly from simultaneous army/deploy submits and `claimTimeout` races |
| §3.5 | Server-side projection, RLS on with no policies, whitelist projection | What is hidden: §7.5 |
| §3.6–3.9 | Anonymous tokens, 6-digit codes + scrypt password, 24 h expiry, presence | None. Presence is UI-only, and game rules never read it |

### 3.2 Randomness
- Every roll (damage in `[min, max]`, luck, morale, ability chances, evasion, starting order) uses `ctx.rng` inside the handler. In production that is `cryptoRng`; tests inject a seeded rng.
- No seed is stored, so a client can't predict outcomes. The trade-off: a battle can't be recomputed from actions alone. The event log records outcomes, which is enough for history.
- The engine never calls `Math.random()` or `Date.now()`. A unit test greps `src/engine` and `src/game` for both.

### 3.3 Engine split and sharing with the client
```
src/engine/   pure rules: data, grid, pathfinding, line of sight, damage, abilities, turn order, victory
src/game/     the GameModule: state machine, zod payload schemas, projection, events
```
- **Import rule:** `engine/` imports only from `engine/`. `game/` imports from `engine/`, `game/` and `zod` (plus types from `models/`). A test fails the build if any other import appears. This is what lets the client copy the folders verbatim.
- The client copies both folders with a sync script (client plan §5). This repo is the single source of truth for rules and data.
- `engine/version.ts` exports `DATA_VERSION` (for example `"2026.11.0"`). Bump it on any change to data or rules.

### 3.4 Battle events inside the snapshot
- Each state change that matters for animation appends events with a monotonically increasing `seq`: `moved`, `attacked`, `shot`, `damaged`, `retaliated`, `abilityUsed`, `healed`, `resurrected`, `statusApplied`, `stackDied`, `morale`, `luck`, `turnStarted`, `roundStarted`, `timedOut`, `surrendered`, `playerEliminated`, `battleOver`.
- `state.battle.events` keeps the **last 64**. The projection sends them as `game.events`.
- The client animates events with `seq > lastAnimatedSeq`. If the first event in a snapshot is newer than `lastAnimatedSeq + 1` (a gap after a reconnect), it skips animation and renders the state as is.
- The events are part of the deterministic view, so ETag/304 keeps working (SR §3.1.3).
- The full event log, capped at 3000 entries, is in `state.history` and served by `GET /history`.

### 3.5 Turn timer without a scheduler
- When a turn starts, the handler sets `battle.turnDeadline = ctx.now + settings.turnSeconds`. It is an ISO string in state, so it is deterministic in the view.
- Any player may send `pocket-legions.claimTimeout`. The handler accepts it only if `ctx.now >= turnDeadline`, otherwise it returns `409 too-early`. It then puts the active player's first unactivated stack into **defend** and passes the turn. Because the version changes, a second claim fails with `conflict` and can be ignored.
- Clients send the claim when their clock passes `turnDeadline + 1 s`. The server decides with its own clock, so a wrong client clock can only make a claim early (rejected) or late (harmless).
- Consecutive timeouts per player are counted. **3 timeouts in a row (≈ 2.25 min at 45 s) = automatic surrender** (§12.1, design §3).

### 3.6 Data version policy
- `settings.dataVersion` is fixed at create time from `DATA_VERSION`.
- The server holds only the current data. If a session's `dataVersion` differs from the deployed one, every action and the socket handshake return `409 { code: 'outdated' }`, and the client shows "The game was updated — start a new room".
- Balance deploys therefore end games that are running. Deploy when nobody is playing, or keep the previous data module for 24 h if that becomes a problem (§11).

---

## 4. Database

### 4.1 Required DB objects (created manually by the owner)
Same shape as SR §4.1, renamed. There is no `game_type` column because there is one game.

```sql
create table if not exists public.pocket_legions_session (
  id              uuid primary key default gen_random_uuid(),
  code            text not null check (code ~ '^[0-9]{6}$'),
  status          text not null default 'pending'
                  check (status in ('pending', 'in_progress', 'finished')),
  password_hash   text,
  host_player_id  uuid not null,
  state           jsonb not null default '{}'::jsonb,
  presence        jsonb not null default '{}'::jsonb,
  version         integer not null default 1,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours')
);

create unique index if not exists pocket_legions_session_code_live_uq
  on public.pocket_legions_session (code) where archived = false;

alter table public.pocket_legions_session enable row level security;

create or replace function public.pocket_legions_session_presence(
  p_session_id uuid, p_player_ids uuid[], p_online boolean
)
returns void
language sql
as $$
  update public.pocket_legions_session
     set presence = presence || (
       select coalesce(jsonb_object_agg(
                pid::text,
                case when p_online then to_jsonb(now()) else 'null'::jsonb end
              ), '{}'::jsonb)
         from unnest(p_player_ids) as pid
     )
   where id = p_session_id and archived = false;
$$;

revoke execute on function public.pocket_legions_session_presence(uuid, uuid[], boolean)
  from public, anon, authenticated;
```

Checklist:
- [x] table `pocket_legions_session` with the columns above
- [x] partial unique index on `code where archived = false`
- [x] RLS enabled, no policies
- [x] function `pocket_legions_session_presence(uuid, uuid[], boolean)`
- [x] Realtime enabled, no `realtime.messages` policy that lets `anon`/`authenticated` join `pocket-legions-session:*`

Done by the owner (2026-10-27) in the same Supabase project as sen-reveal; `npm run smoke:db` and `npm run smoke:relay` pass against it.

### 4.2 `state` JSON shape (top level, as in SR §4.2)
```ts
interface SessionState {
  players: PlayerRecord[];            // copied as is (SR §4.2)
  settings: CoreSettings & PocketLegionsSettings;
  game: PocketLegionsState | null;         // null while pending (§7.2)
}
```
`CoreSettings.allowJoinInProgress` is always `false`. `maxPlayers` is 2–4.

---

## 5. Code structure

`C` = copied from sen-reveal-api with renames only. `A` = copied and adapted. `N` = new.

```
src/
  app.ts, index.ts, runtime.ts          C  (runtime: registry removed, the single module injected)
  models/
    result.ts                           A  + error codes 'too-early', 'outdated', 'invalid-army', 'invalid-deploy', 'not-your-turn', 'illegal-action'
    session.model.ts, session.schemas.ts A  (no gameType; settings schema is PocketLegions's)
    action.model.ts                     C
  services/                             C  session.service, lobby.actions, roster, presence, sessionView,
                                           sessionRepository.service (table/RPC names), sessionRepository.memory
  realtime/                             C  socketServer, sessionBus (topic name), broadcaster, localSessions,
                                           presenceTracker, maintenanceTick
  routes/, middlewares/, utils/         C  (corsUtils reads CORS_ORIGINS from env only)
  testing/harness.ts                    A  (in-memory runtime with the pocket-legions module)
  games/
    gameModule.ts                       C  the GameModule interface (SR §6), kept so the dispatcher stays identical
  engine/                               N  §6 — pure, shared with the client
    version.ts                          DATA_VERSION
    data/                               races.ts, abilities.ts, heroes.ts, items.ts, maps.ts (ported from design/data)
    balance.ts                          unit cost formula (design §4)
    grid.ts                             coordinates, neighbours, Chebyshev distance, map build + validation
    pathfinding.ts                      reachable cells per stack (walk, fly, teleport, statuses)
    los.ts                              line of sight against high obstacles
    army.ts                             army/gear validation and aggregated hero bonuses
    damage.ts                           the damage pipeline (§6.4) and previews
    abilities.ts                        ability hooks (§6.6)
    turns.ts                            alternating activation, rounds, morale
    battle.ts                           applyAction(battleState, action, rng) → { state, events }
    victory.ts                          elimination, teams, round limit and points
  game/                                 N  §7 — the GameModule
    pocketLegions.module.ts, pocketLegions.state.ts, pocketLegions.actions.ts, pocketLegions.projection.ts, pocketLegions.hints.ts
```

The `GameRegistry` is dropped. The dispatcher routes `lobby.*` to lobby actions and `pocket-legions.*` to the one module, and rejects any other namespace with `400`.

Dependencies are the same as sen-reveal-api: `express`, `socket.io`, `zod`, `express-rate-limit`, `@supabase/supabase-js`, `cors`, `dotenv`. Dev: `vitest`, `supertest`, `socket.io-client`, `ts-node`, `nodemon`. Node ≥ 22.

---

## 6. Engine (`src/engine`)

### 6.1 Data and balance
- Port `gamedata.js` → typed `data/*.ts`. Each unit has: `id, raceId, tier, name, atk, def, dmg: [min, max], hp, spd, fly, hits, ranged?: { range, shots }, abilities: AbilityId[], cost`. The `art` field stays in the client.
- `cost` is copied from `design/generated/units.json`. `balance.ts` implements the formula from design §4, and a test asserts `round5(9 × power(unit)) === unit.cost` for all 60 units. Changing stats without re-running the formula fails the build.
- Maps: port `maps.js` (`rot4`/`rot2` symmetry, deploy zones, validation). Tests check that every map validates: zones free, every free cell reachable on foot.

### 6.2 Grid and movement
- Square grid, 8 directions, diagonal step = 1, **no corner cutting** past a blocked orthogonal cell.
- Ground stacks: blocked by obstacles and enemy stacks. They can pass through friendly stacks but can't stop on them.
- Flyers: pass over everything and land on a free cell within `spd`.
- Teleport: any free cell within `spd`, ignoring obstacles.
- Statuses: `entangled` → no movement this activation. `maimed` → `spd − 2`. `cloak_wind` → `+1` in round 1. Boots items modify `spd`.
- `reachable(stack)` returns `{ cell, path, cost }[]` with BFS. Both hints and validation use it, so the client never sees a move the server rejects.

### 6.3 Line of sight
- A shot is allowed only if the Bresenham line between cell centres crosses no **high** obstacle (`pillar, house, mill, crypt, mountain, ruin`, and the dwarf hero's temporary wall). Low obstacles and stacks don't block.
- Damage applies at range ≤ `range` (full) or beyond (×0.5); magic shot ignores the penalty. An enemy adjacent to the shooter means ×0.5, unless the shooter has `no_melee_pen`.

### 6.4 Damage pipeline (one function, fixed order)
1. Evasion roll (target `evasion` 25%) → miss event, stop.
2. Base = Σ over N attackers of `rng.int(min..max)` (N ≤ 500, so a loop is fine).
3. Effective attack/defence: unit + hero + gear + racial (`Стрій` +2 def when a friendly stack is adjacent, `Лють` +1/lost unit up to +4) + statuses (`war_drum` +4, `rune_shield` +5, `disease` −3, `rage` +2/hit up to +6, defend ×1.3 or ×1.5 for dwarves).
4. `piercing` ×0.6 def, ranged `magic_shot` ×0.5 def → `K_AD` (design §3).
5. Ranged modifiers (range, adjacency), `shield`/`bone` ×0.5 vs shots, gear `cloak_shadow` −15%.
6. Attack modifiers: `charge` +6%/cell moved (max +36%), `holy` ×1.5 vs undead/demons, hero `Бойовий клич` +25%, `scream` −25%, `heavenly shield` −50%.
7. Luck roll: chance 5% × |luck|, ×2 or ×0.5 (demons never roll negative luck). `deathblow` 20% ×2.
8. `floor`, min 1 → subtract from the stack HP pool → kills.
9. On-hit effects: `lightning` (25%, +50% ignoring defence), `burn`, `stun`/`fear`/`blind` (skip the next activation; undead immune to fear and blind), `disease`, `entangle`, `maim`, `lifesteal` (heal 50%, may revive up to the starting count), attacker's `fire_shield` reflection 20%.
10. Area: `aoe_cloud` (target + neighbours, allies too), `boulder` (enemies only), `breath` (the cell behind), `whirlwind` (all adjacent enemies), `thunderclap` (50% to the target's neighbours), `chain_shot` (50% to one more enemy within 2).

`preview(attacker, target, kind)` runs steps 2–6 with min and max rolls and no random effects, and returns `{ dmg: [min, max], kills: [min, max] }` for hints.

### 6.5 Turn order (design §3)
- Order of play: the starting seat is random (`rng`), then clockwise. Each turn activates exactly one stack that hasn't acted this round. A player with no unactivated stacks is skipped. The round ends when every stack has acted. The next round starts with the next seat.
- One activation: optional hero ability first (a free action, 2 uses, 3-round cooldown, 3 uses with `mantle`), then one of: `move`, `moveAttack`, `shoot`, `ability` (support abilities, which may follow a move), `defend`.
- Retaliation: once per round per stack, unless `unlim_retal` or `shield_guard`. Never against shots or `no_retal` / `bombard` / `hit_and_run` attackers.
- Morale (not for undead or mechanisms): after the activation, `5% × morale` → the same stack acts again. Negative morale → `5% × |morale|` that the activation is skipped. Each case emits a `morale` event.
- Vampires' necromancy: at round end, 15% of the HP of enemies killed this round is added as skeletons to the vampire player's skeleton stack, if it is alive.

### 6.6 Abilities
`abilities.ts` maps each `AbilityId` to hooks: `movement`, `modifyAttack`, `modifyDefence`, `onHit`, `onHitTaken`, `active` (replaces the attack: heal, war drum, scream, rune shield, resurrect), `roundEnd`.

Every ability in design §6 needs at least one unit test that shows the effect and one that shows it doesn't fire when it shouldn't. Examples: `no_retal` → no retaliation event; `bombard` → attack while flying over the target; `hit_and_run` → back on the start cell after the hit.

### 6.7 Armies, heroes, gear
- `validateArmy(army, race, settings)`: units of the chosen race only, 1–6 stacks (5 on 10×10 maps with 3–4 players), at most 2 stacks of one unit type, at most 2 champions at budget 1000 (scaled with budget), total ≤ budget, gear ≤ 30% of the budget, 1 item per slot plus 2 rings. Each failure has its own `invalid-army` reason.
- Gear prices scale with the budget (design §2). The budget multiplier is applied in `army.ts` so the client shows the same number.
- `heroBonuses(race, items)` returns `{ atk, def, luck, morale, extras }` with caps of ±5 for luck and morale.

### 6.8 Victory
- FFA: the last player with living stacks wins. 2v2: the last team.
- Round 30 ends the battle. The winner has the most points of living army (stack count × unit cost); ties stay ties.
- Surrender and auto-surrender (§3.5) remove that player's stacks with a `playerEliminated` event.

### 6.9 Engine tests
- Formula tests for `K_AD`, luck, range and adjacency penalties, charge, each ability (§6.6), pathfinding (corners, friendly pass-through, flyers, teleport), LOS through high and low obstacles.
- **Fuzz test:** 500 battles on random maps with random legal armies, where each turn picks a random legal action from the hints. Invariants:
  - no stack on an obstacle or on another stack;
  - HP and counts never negative;
  - only legal actions applied;
  - every battle ends by round 30;
  - `seq` strictly increasing;
  - the projection never leaks a hidden field.

---

## 7. Game module (`src/game`)

### 7.1 Settings (`settingsSchema`, validated on create)
```ts
interface PocketLegionsSettings {
  mapId: MapId;                         // one of 8
  budget: 500 | 1000 | 1500 | 2000;     // default 1000
  mode: 'ffa' | 'teams';                // 'teams' requires exactly 4 players at start
  turnSeconds: number;                  // 30..90, default 45
  dataVersion: string;                  // set by the server, not the client
}
```
`minPlayers` 2, `maxPlayers` 4 (and ≤ the map's recommendation: Arena 10×10 allows 4 but warns in the UI).

### 7.2 State
```ts
interface PocketLegionsState {
  phase: 'army' | 'deploy' | 'battle' | 'over';
  seats: Seat[];                        // in join order at start
  battle: BattleState | null;
  result: { winnerSeats: number[]; reason: 'elimination' | 'round-limit' | 'surrender' | 'not-enough-players'; points?: number[] } | null;
  history: GameEvent[];                 // capped at 3000
}

interface Seat {
  playerId: string;
  seat: number;                         // 0..3, decides the deploy zone and colour
  team: 0 | 1 | null;                   // null in ffa
  raceId: RaceId | null;
  army: { stacks: { unitId: UnitId; count: number }[]; items: Partial<Record<Slot, ItemId>>; rings: ItemId[] } | null;
  armyReady: boolean;
  deployment: { stackIndex: number; x: number; y: number }[] | null;
  deployReady: boolean;
  eliminated: boolean;
  timeoutsInRow: number;
}

interface BattleState {
  round: number;
  firstSeat: number;                    // rotates each round
  activeSeat: number;
  turnDeadline: string;                 // ISO
  stacks: StackState[];                 // id, seat, unitId, count, hpTop, x, y, shots, retaliationsLeft, activated, statuses[], startCount
  heroes: { seat: number; usesLeft: number; cooldown: number }[];
  walls: { x: number; y: number; untilRound: number }[];   // dwarf hero ability
  events: GameEvent[];                  // last 64 (§3.4)
  nextSeq: number;
}
```

### 7.3 Actions (`pocket-legions.<name>`; game actions require `status === 'in_progress'`, SR §6)
| Action | Phase | Who | Payload | Effect / errors |
|---|---|---|---|---|
| `pickRace` | army | any seat | `{ raceId }` | Sets the race and clears the army. Rejected once `armyReady` |
| `setTeam` | army | host | `{ playerId, team }` | 2v2 only. Defaults: seats 0+2 vs 1+3 |
| `submitArmy` | army | any seat | `{ stacks, items, rings }` | `validateArmy` → `invalid-army { reason }`. Sets `armyReady`. Resubmitting before everyone is ready is allowed. When all seats are ready → `deploy` |
| `unready` | army, deploy | any seat | `{}` | Clears this seat's ready flag for the current phase |
| `submitDeploy` | deploy | any seat | `{ placements }` | Every stack placed once, inside its zone, on a free cell → `invalid-deploy`. When all are ready → `battle`: random `firstSeat`, `turnStarted` event |
| `act` | battle | the active seat | `{ stackId, kind, path?, target?, cell? }`. `kind`: `move` \| `attack` \| `shoot` \| `ability` \| `defend` | Validated against the same hints the projection shows → `not-your-turn` / `illegal-action { reason }`. Applies, emits events, advances the turn |
| `heroAbility` | battle | the active seat, before `act` | `{ target?, cell?, cells? }` | Uses, cooldown and target checks → `illegal-action` |
| `claimTimeout` | battle | any seat | `{}` | §3.5. `too-early` before the deadline |
| `surrender` | battle | any seat | `{}` | Eliminates the seat. May end the battle |
| `rematch` | over | host | `{}` | Back to `army` with the same seats, races and armies (not ready); seats of players who left are dropped. `409` if the rest can't start on this map (§12.6) |

`lobby.start` (from the lobby) creates the initial state: phase `army`, seats in join order, all `raceId` null. Before it, the host can change settings with `lobby.updateSettings` (§12.7).

The end of a battle moves to phase `over` but keeps the session `in_progress`, so the room can play a rematch (§12.6).

### 7.4 Roster hooks
- `onPlayerJoined` is never called after start (`allowJoinInProgress: false`).
- `onPlayerRemoved`:
  - In `army`/`deploy`, drop the seat. If fewer than 2 seats remain, or a 2v2 team is empty → `over`, `not-enough-players`, `finished`.
  - In `battle`, eliminate the seat, and if it was the active seat, advance the turn.

### 7.5 Projection (`project(state, viewerId)`)
- **Always:** phase, map id, settings, seats with `{ playerId, seat, team, raceId, armyReady, deployReady, eliminated }`.
- **Army phase:** your own full army. For others: only race and readiness. Spent budget is computed for your own army only.
- **Deploy phase:** your placements. Others' placements are hidden until `battle`.
- **Battle:**
  - all stacks (visible to everyone), heroes (uses, cooldown), `round`, `activeSeat`, `turnDeadline`, `events`;
  - `hints` only for the viewer when it's their turn:
    ```ts
    hints: {
      stacks: { stackId; moves: Cell[]; attacks: { targetId; from: Cell[]; preview }[];
                shots: { targetId; penalty: ('range' | 'adjacent')[]; preview }[];
                abilities: { abilityId; targets: string[] }[]; canDefend: boolean }[];
      hero: { targets: string[]; cells: Cell[] } | null;
    } | null
    ```
    `preview = { dmg: [min, max], kills: [min, max] }`.
- **Over:** `result` plus the final stacks. In `over`, a removed player's seat is dropped; with fewer than 2 seats left the session finishes.
- **No time-derived fields.** There is no `canClaimTimeout`: it would change without a state change and break ETag. The client compares `turnDeadline` with its own clock.
- Arrays, not maps, ordered by seat/stack id, so the JSON is deterministic (SR §8 deviation note).

---

## 8. Request pipelines

Identical to SR §7.1–7.4. Two additions to `dispatchAction`:
- After resolving the actor: if `settings.dataVersion !== DATA_VERSION` → `409 outdated`.
- The router: `lobby.*` → lobby actions, `pocket-legions.*` → module actions, anything else → `400`.

---

## 9. API contract

Same as SR §9, with these changes:

| Method & path | Body | Response |
|---|---|---|
| `POST /api/sessions` | `{ nickname, password?, settings: { mapId, budget, mode, turnSeconds } }` | `201 { playerId, playerToken, session }` |
| `GET /api/sessions/:code/info` | — | `{ code, status, requiresPassword, playerCount, maxPlayers, joinable, expiresAt, mapId, mode, budget }` |
| `POST /api/sessions/:code/join` | `{ nickname, password? }` | as SR. `409 session-started` after `lobby.start` |
| `GET /api/sessions/:code/state` | — | `SessionView<PocketLegionsView>` + ETag |
| `POST /api/sessions/:code/actions` | `{ type, payload }` | `SessionView` |
| `GET /api/sessions/:code/history` | — | `GameEvent[]` (full log, capped) |

Socket.IO events are identical (SR §9.2). The client contract is SR §9.3 plus:
1. Animate `game.events` with `seq > lastAnimatedSeq`; on a gap, skip to the state (§3.4).
2. Send `pocket-legions.claimTimeout` once when the local clock passes `turnDeadline + 1 s`. Ignore `too-early` and `conflict`.
3. On `409 outdated`, show "The game was updated" and offer a new room.
4. Compare `settings.dataVersion` with the client's synced `DATA_VERSION`. If they differ, prompt a reload before acting.

---

## 10. Implementation phases

Each phase ends in a working, tested state. Phases 1–3 need no DB and no network. After Phase 3 the client can start hot-seat work on the copied engine.

### Phase 0 — Scaffold from sen-reveal-api
- [x] New repo. Copy the files marked `C`/`A` in §5 from sen-reveal-api `83a5261`. Rename the table, RPC and topic. Remove `games/` modules and the registry. Keep `gameModule.ts`.
- [x] A tiny `test-game` module in tests (as SR Phase 3) so the copied lobby/session tests keep running.
- [x] `README.md` with the source commit, env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`, `PORT`, `LOG_LEVEL`) and scripts.
- [ ] Vercel project with Fluid compute on (moved to Phase 7). Reuse sen-reveal's WebSocket spike result, or run it (SR Phase 0) if it is still open.
- **Done when:** `npm run test:run` passes with the copied tests on the in-memory repo, and `npm run build` passes.
- **Status (commit ceebe44):** done, except the Vercel project (not created yet). Differs from the plan:
  - no `gameType` anywhere; `createRuntime({ module })` takes the one module (tests inject `test-game`);
  - `GameModule.allowJoinInProgress?: boolean` pins the core setting to false; a join after start returns `409 session-started`;
  - `Result.errorReason` / `ApiError.reason` carry the finer reason of `invalid-army`, `invalid-deploy` and `illegal-action`;
  - `@types/express-serve-static-core` is pinned to `5.0.6`, so the copied routes compile unchanged;
  - `dist/` is git-ignored (sen-reveal commits it for `vercel.json`); to decide in Phase 7.

### Phase 1 — Engine data, balance and maps
- [x] `engine/data/*` ported from `design/data`. `engine/version.ts`.
- [x] `balance.ts` + the cost test (§6.1). `grid.ts` map build/validate + tests for all 8 maps.
- [x] Import-rule test (§3.3) and the `Math.random`/`Date.now` grep test (§3.2).
- **Done when:** all 60 costs match and all 8 maps validate.
- **Status (commit 667216a):** done. The data now lives in `src/engine/data` (the source of truth from here on). Map player limits are in `MapDef.ffaPlayers` / `teams`. The import-rule test is `src/purity.test.ts` (outside `engine/`, so the client copy has no Node test). It also lets `game/` `import type` from `games/gameModule`, besides types from `models/`.

### Phase 2 — Combat engine
- [x] `pathfinding.ts`, `los.ts`, `army.ts`, `damage.ts` (+ `preview`), `abilities.ts`, `turns.ts`, `battle.ts`, `victory.ts`.
- [x] Unit tests per §6.9 and every ability. The fuzz test.
- **Done when:** 500 fuzz battles pass the invariants with a seeded rng, and every ability has tests.
- **Status (commit 2c42061):** done. Extra files: `state.ts` (battle state, events), `stats.ts` (effective stats), `effects.ts` (damage/heal/status primitives), `heroes.ts` (hero abilities). `BattleState` also has `order`, `turn`, `bonusStackId` (morale) and `killedThisRound` (necromancy). The projection part of the fuzz invariants is checked in Phase 3 (`pocketLegions.fuzz.test.ts`). Rule interpretations where the design is silent (magic sources for stone skin, heal without revive, skip timing, splash rules, mantle power, 2 vs 2 corners and turn order) are listed in the session notes and should be confirmed in playtests.

### Phase 3 — Game module
- [x] `pocketLegions.state.ts`, `pocketLegions.actions.ts` (§7.3), `pocketLegions.hints.ts`, `pocketLegions.projection.ts` (§7.5), `pocketLegions.module.ts`. Wire it into the dispatcher.
- **Unit tests:**
  - other armies hidden in the army phase and deployments hidden until battle, asserted on the **whole serialized view**;
  - hints equal what `act` accepts: for every hint, `act` succeeds; for a sample of non-hint cells, `act` fails;
  - `claimTimeout` before and after the deadline, a double claim, and 3 timeouts → auto-surrender;
  - roster removal in each phase;
  - the projection is deterministic.
- **Done when:** a 2-player and a 2v2 battle play to the end through `module.actions` alone.
- **Status (commit b9972e6):** done. Differs from the plan:
  - the `outdated` check runs in the module's actions; the dispatcher and socket handshake checks (§8) and `mapId`/`mode`/`budget` in `GET /info` (§9) are left for Phases 4–5;
  - `heroAbility` also takes `ally` (the blood ritual heal target), and `hints.hero` has `allies`;
  - player counts per map/mode are checked at `lobby.start`; in 2 vs 2 each team needs 1–2 players before `submitArmy`;
  - leaving during deploy clears every placement (the zones can change);
  - the former open questions were decided later; see §12.

### Phase 4 — Database and sessions over HTTP
- [x] **Prerequisite (owner):** DB objects from §4.1.
- [x] Copied repository against the real table; `npm run smoke:db`.
- [x] **Integration test** (supertest, in-memory repo, seeded rng): 2 players create/join → start → armies → deploy → battle to the end using `/actions` + `/state`. Simultaneous `submitArmy` from 4 players loses nothing.
- **Done when:** the integration test passes and the smoke script passes against Supabase.

- **Status (commit 0e34527):** done. `smoke:db` passes against the real table (it leaves one row that expires in 24 h). Additions: `GameModule.rejectSession` gives `409 outdated` on every action, lobby ones included, and on the socket handshake (`/state` stays readable). `GameModule.publicInfo` adds `mapId`, `mode` and `budget` to `/info`. The integration test is `src/game/pocketLegions.integration.test.ts`.

### Phase 5 — Real-time
- [x] Copied `realtime/` with the renamed topic, and the copied integration tests adapted.
- **New tests** (two servers sharing an in-memory bus):
  - no payload to player B contains A's army before `battle`;
  - an `act` on server A reaches clients on server B with the events in order;
  - two `claimTimeout`s on different servers → exactly one applied.
- [ ] Manual Vercel preview test: 2 browsers play a full battle across at least one forced reconnect.
- **Done when:** the tests pass and the preview battle survives reconnects.

- **Status (commit 5286ee2):** done except the manual Vercel preview test (needs the Vercel project, Phase 7). The new tests are in `src/game/pocketLegions.realtime.test.ts`; the two-instance helper moved to `src/testing/cluster.ts`. A new `npm run smoke:relay` checks the real Supabase relay on `pocket-legions-session:<id>`. Its first run failed once with `MissingPartition` (Realtime had no `realtime.messages` partition yet in an idle project), then it passed three times in a row. The maintenance tick covers such a lost message.

### Phase 6 — Hardening and contract
- [ ] WAF rule (SR Phase 6). *Owner, in the Vercel dashboard once the project exists.*
- [x] In-app limits, socket payload guard, structured logs (copied from sen-reveal-api).
- [x] `docs/implementation/pocket-legions.api-contract.md`: endpoints, socket events, client rules (§9), and example `SessionView`s for army, deploy, battle (as the active and as a waiting player) and over.

- **Status:** done except the WAF rule. Measured on random battles: the largest stored state was 82 KB (845 history events, about 85 bytes each) and the largest view 24 KB. A long 4-player battle can pass the 100 KB per row target (§3.1, the SR §3.3 row) because of `history` (see §12.5).

### Phase 7 — Deployment
- [ ] Vercel project with Fluid compute (moved here from Phase 0), and the sen-reveal WebSocket spike (still open in SR) run on it.
- [ ] Decide how `dist/` reaches Vercel: commit it as sen-reveal does (`vercel.json` points at `dist/index.js`), or let Vercel run `npm run build`. It is git-ignored for now.
- [ ] Env on Vercel. Function region = Supabase region. Add the client origin to `CORS_ORIGINS`.
- [ ] Smoke test from the deployed client: a 3-player FFA on 3 phones, one on mobile data, one with WebSockets blocked (polling).
- [ ] Review Hobby usage after real games. The quotas are shared with sen-reveal if they are per account.

---

## 11. Future work
- **Shared infrastructure package.** Once both repos are stable, extract `services/`, `realtime/`, `routes/`, `middlewares/` into a private package used by sen-reveal-api and pocket-legions-api. Until then, port fixes by diffing against the recorded source commit.
- Keep the previous data module for 24 h so balance deploys don't end running games (§3.6).
- AI opponent built on the engine's hints (a greedy bot is a good first step), spectators, replays from `history`.
- Upstash/Ably swap-ins exactly as SR §11.

---

## 12. Decisions on the former open questions (2026-10-27)
1. **Auto-surrender:** 3 timed-out turns in a row, as implemented (§3.5). The design doc says the same since rev 56.
2. **Supabase project:** the same project as sen-reveal. The owner created the §4.1 objects there.
3. **Gear budget:** one budget shared by units and gear, with gear capped at 30% of it (`validateArmy`).
4. **Balance deploys** end running games with `409 outdated` (§3.6). Accepted for now; deploy when nobody plays.
5. **History size:** `state.history` stays capped at 3000 events (up to ≈ 260 KB per row in a very long battle), above the 100 KB target in §3.1. Accepted.
6. **Rematch** (client plan §15.2): in the same room. `pocket-legions.rematch` (host, phase `over`) goes back to `army` with the same seats, races and armies (not ready). So the end of a battle no longer finishes the session: it stays `in_progress` in phase `over` until the host ends it, a rematch starts, or fewer than 2 players are left.
7. **Lobby settings** (client plan §15.3): the host may change them before the start with `lobby.updateSettings` (any subset of the create settings, validated the same way; `maxPlayers` can't drop below the players already in).

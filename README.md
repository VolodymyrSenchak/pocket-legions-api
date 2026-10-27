# pocket-legions-api

Backend for Pocket Legions, a turn-based tactics game for 2–4 players. It provides anonymous players, 6-digit room codes, a lobby, and the battle itself, which the server validates and runs. Game state is synced in real time over Socket.IO, with an HTTP polling fallback.

Architecture copied from sen-reveal-api: Express + Socket.IO on Vercel, Supabase as the database only.

- Plan: [docs/implementation/pocket-legions.api.implementation-plan.md](docs/implementation/pocket-legions.api.implementation-plan.md)
- Game design: [../design/pocket-legions.game-design.md](../design/pocket-legions.game-design.md)
- Client: [../pocket-legions-app](../pocket-legions-app/README.md)

## Source of the infrastructure code

`src/app.ts`, `index.ts`, `runtime.ts`, `models/`, `services/`, `realtime/`, `routes/`, `middlewares/`, `utils/`, `testing/`,
`games/gameModule.ts` and `scripts/repositorySmoke.ts` are copied from
**sen-reveal-api at commit `83a5261`** (plan §5). To port a fix, diff the file against that commit in sen-reveal-api.

What differs from the source:
- One game: the `GameRegistry` and the game folders are gone. The runtime takes a single `module`
  (`pocket-legions` by default, the stub `test-game` in the copied tests). `lobby.*` goes to the lobby, `<module.type>.*` to the module, anything else is `400`.
- No `gameType` anywhere (row, view, info, create body). Table `pocket_legions_session`, RPC `pocket_legions_session_presence`,
  relay topic `pocket-legions-session:<id>`.
- `GameModule.allowJoinInProgress = false` pins the core setting (no joins after `lobby.start`; join returns `409 session-started`).
- `Result.errorReason` / `ApiError.reason`: a finer machine-readable reason, e.g. `invalid-army` + `too-many-stacks`.
  New error codes: `too-early`, `outdated`, `invalid-army`, `invalid-deploy`, `not-your-turn`, `illegal-action`, `session-started`.
- `corsUtils` reads allowed origins only from `CORS_ORIGINS`.
- `@types/express-serve-static-core` is pinned to `5.0.6` (as installed in sen-reveal-api) so the copied routes compile unchanged.
- `dist/` is not committed (sen-reveal-api commits it for its `vercel.json` build). Decide at deployment (plan Phase 7).

## Requirements

- Node.js 22+
- From Phase 4 on: a Supabase project with the DB objects from plan §4.1. There are no migrations — the owner creates them manually.

## Environment

Read from `.env.local` (or `.env`):

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key (server only) |
| `CORS_ORIGINS` | no | Comma-separated allowed browser origins (none by default) |
| `PORT` | no | Local port, default 8080 |
| `LOG_LEVEL` | no | `debug` \| `info` (default) \| `warn` \| `error` \| `silent` |

## Scripts

```bash
npm start           # dev server (nodemon + ts-node), HTTP + Socket.IO on the same port
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit, tests included
npm test            # vitest (watch); npm run test:run for a single run
npm run smoke:db    # checks the repository against the real Supabase DB (creates one row)
```

Tests use an in-memory repository and bus, so they need no database or network.

## Layout

```
src/
  app.ts, index.ts, runtime.ts   Express app, entry (exports the http.Server), composition root
  models/                        Result, session types, request schemas
  services/                      session pipeline, lobby actions, repository (Supabase + in-memory), projection
  games/gameModule.ts            the GameModule interface the dispatcher talks to
  realtime/                      Socket.IO server, relay bus, broadcaster, presence, maintenance tick
  middlewares/, routes/, utils/
  engine/                        pure battle rules and data, shared with the client (plan §6)
  game/                          the pocket-legions GameModule: state, actions, hints, projection (plan §7)
  testing/                       in-memory harness and the stub test-game module
```

`engine/` and `game/` are pure TypeScript: no Node, DB or socket imports, no `Math.random()` / `Date.now()`
(a test enforces both). The client copies these two folders verbatim.

/**
 * Phase 1 manual check against the real Supabase project.
 * Requires the DB objects from docs/implementation/pocket-legions.api.implementation-plan.md §4.1.
 *
 * Creates ONE session row (rows are never deleted by design; it expires after 24 h),
 * CAS-updates it, checks that a stale update returns null and that a presence update
 * doesn't change the version.
 *
 * Run: npm run smoke:db
 */
import { randomUUID } from "node:crypto";
import "../src/utils/envVariables";
import { SupabaseSessionRepository } from "../src/services/sessionRepository.service";
import { cryptoRng } from "../src/utils/random";
import { generateSessionCode } from "../src/utils/sessionCode";
import { getSupabaseClient } from "../src/utils/supabaseDb";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAILED: ${message}`);
  }
  console.log(`ok - ${message}`);
}

async function main(): Promise<void> {
  const repository = new SupabaseSessionRepository(getSupabaseClient());
  const hostPlayerId = randomUUID();

  const inserted = await repository.insertWithUniqueCode(
    {
      status: "pending",
      passwordHash: null,
      hostPlayerId,
      state: { players: [], settings: { maxPlayers: 4, allowJoinInProgress: false }, game: null },
      presence: {},
    },
    () => generateSessionCode(cryptoRng),
    new Date()
  );
  check(inserted.isSuccess, `insertWithUniqueCode ${inserted.error ?? ""}`);
  const row = inserted.result!;
  console.log(`   created session ${row.id} with code ${row.code}`);

  check((await repository.findLiveByCode(row.code)).result?.id === row.id, "findLiveByCode");
  check((await repository.findById(row.id)).result?.version === 1, "findById");

  const draft = {
    status: row.status,
    hostPlayerId: row.hostPlayerId,
    state: { ...row.state, settings: { ...row.state.settings, maxPlayers: 3 } },
  };
  check((await repository.compareAndSwap(row.id, 1, draft)).result?.version === 2, "compareAndSwap bumps the version");
  const stale = await repository.compareAndSwap(row.id, 1, draft);
  check(stale.isSuccess && stale.result === null, "a stale compareAndSwap returns null");

  check((await repository.setPresence(row.id, [hostPlayerId], true)).isSuccess, "setPresence");
  const after = (await repository.findById(row.id)).result;
  check(after?.version === 2, "presence does not change the version");
  check(!!after?.presence[hostPlayerId], "presence is stored");
  check((await repository.getVersions([row.id])).result?.[0]?.version === 2, "getVersions");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Phase 5 manual check of the server-only relay against the real Supabase project:
 * one client subscribes to `pocket-legions-session:<random id>`, another publishes, the message must arrive.
 * Sends no game data and writes no rows.
 *
 * Run: npm run smoke:relay
 */
import { randomUUID } from "node:crypto";
import "../src/utils/envVariables";
import { BusMessage, SupabaseRealtimeBus } from "../src/realtime/sessionBus";
import { getSupabaseClient } from "../src/utils/supabaseDb";

async function main(): Promise<void> {
  const subscriber = getSupabaseClient();
  const bus = new SupabaseRealtimeBus(getSupabaseClient(), subscriber);
  const sessionId = randomUUID();
  console.log(`   topic ${SupabaseRealtimeBus.topic(sessionId)}`);

  const received = new Promise<BusMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("FAILED: no relay message within 15 s")), 15_000);
    bus.subscribe(sessionId, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  // give the subscription time to join before publishing
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await bus.publish(sessionId, { version: 7, reason: "state" });
  const message = await received;
  if (message.version !== 7 || message.reason !== "state") {
    throw new Error(`FAILED: unexpected message ${JSON.stringify(message)}`);
  }
  console.log("ok - a published relay message reaches the subscriber");
  bus.unsubscribe(sessionId);
  await subscriber.removeAllChannels();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

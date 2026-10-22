import { createTable } from "../create-table";
import {
  createScriptClient,
  createScriptDocClient,
  log,
  resolveTarget,
} from "./dynamodb-local";
import { buildSeedData } from "./seed-data";
import type { SeedProfile } from "./seed-data";
import { writeSeed } from "./seed-writer";

// Shared body of the seed CLIs. Seeding into a non-empty table overlays
// (same keys overwrite, other items remain) — use a fresh DynamoDB Local
// volume for a clean slate.
export async function runSeed(profile: SeedProfile): Promise<void> {
  const target = resolveTarget();
  const client = createScriptClient(target);
  try {
    await createTable(client, target.tableName);
    const counts = await writeSeed(
      createScriptDocClient(client),
      target.tableName,
      buildSeedData(profile, new Date()),
    );
    log(
      `Seeded "${profile}": ${counts.accounts} accounts, ${counts.rollups} rollups -> ${target.tableName} at ${target.endpoint}`,
    );
  } finally {
    client.destroy();
  }
}

export function runSeedCli(profile: SeedProfile): void {
  runSeed(profile).catch((error: unknown) => {
    process.stderr.write(
      `seed ${profile} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

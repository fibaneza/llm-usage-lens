// Runs once per integration test file, in the file's fresh worker, before the
// test modules load: gives the file its own table,
// `<base>-<pool slot>-<random suffix>`. Per file, not per worker: Vitest frees
// a pool slot when a file ends without awaiting the old worker, so the next
// file can get the same slot while the old worker still writes. The global
// setup deletes the run's tables at the end; nothing here deletes, so a late
// write from a stopping worker raises no error.
import { randomBytes } from "node:crypto";

import { beforeAll } from "vitest";

import { isLocalEndpoint } from "../../../../scripts/lib/dynamodb-local";

const base = process.env.INTEGRATION_TABLE_BASE;
const slot = process.env.VITEST_POOL_ID;

if (!base || !slot) {
  throw new Error(
    "INTEGRATION_TABLE_BASE and VITEST_POOL_ID must be set; refusing a shared table name",
  );
}

const endpoint = process.env.DYNAMODB_ENDPOINT;
if (!endpoint || !isLocalEndpoint(endpoint)) {
  throw new Error(
    `Refusing to create tables on non-local DYNAMODB_ENDPOINT "${endpoint}"`,
  );
}

const suffix = Array.from(randomBytes(8), (b) => (b % 36).toString(36)).join(
  "",
);
process.env.DYNAMODB_TABLE_NAME = `${base}-${slot}-${suffix}`;

// Dynamic import: test-support reads DYNAMODB_TABLE_NAME at module load, which
// must happen after the assignment above.
beforeAll(async () => {
  const { ensureTestTable } = await import("@/test/support/test-support");
  await ensureTestTable();
});

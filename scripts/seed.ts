import { PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  APPTEAMS_GSI1PK,
  META_SK,
  OWNER_SK,
  appTeamGsi1sk,
  appTeamNamePk,
  appTeamPk,
} from "../apps/dashboard/lib/data/access/keys";
import {
  createScriptClient,
  createScriptDocClient,
  log,
  resolveTarget,
} from "./lib/dynamodb-local";
import { runSeed } from "./lib/run-seed";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam". One created
// team (no AWS account) for the e2e specs, in the default seed only.
const CREATED_TEAM = {
  teamId: "appteam-00000000-0000-4000-8000-000000000001",
  name: "Platform Guild",
  departmentId: "dept-engineering",
  departmentName: "Engineering",
  createdBy: "seed",
  createdAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

async function seedCreatedTeam(): Promise<void> {
  const target = resolveTarget();
  const client = createScriptClient(target);
  try {
    const doc = createScriptDocClient(client);
    await doc.send(
      new PutCommand({
        TableName: target.tableName,
        Item: {
          PK: appTeamPk(CREATED_TEAM.teamId),
          SK: META_SK,
          gsi1pk: APPTEAMS_GSI1PK,
          gsi1sk: appTeamGsi1sk(CREATED_TEAM.teamId),
          ...CREATED_TEAM,
        },
      }),
    );
    await doc.send(
      new PutCommand({
        TableName: target.tableName,
        Item: {
          PK: appTeamNamePk(CREATED_TEAM.name),
          SK: OWNER_SK,
          teamId: CREATED_TEAM.teamId,
        },
      }),
    );
    log(`Seeded created team "${CREATED_TEAM.name}"`);
  } finally {
    client.destroy();
  }
}

runSeed("default")
  .then(seedCreatedTeam)
  .catch((error: unknown) => {
    process.stderr.write(
      `seed default failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });

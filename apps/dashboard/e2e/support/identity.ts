/* eslint-disable no-restricted-imports -- test-only seeding of DynamoDB Local; never imported by app code (Rule 10.5 covers app code) */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
/* eslint-enable no-restricted-imports */

// Test-only seeding of a stored Identity row in the DynamoDB Local table the
// E2E dev server reads (playwright.config.ts: bedrock-usage on :8000). The dev
// login only signs in as a stored identity (Access Control - Dev login,
// amended L3c2). Idempotent: the same oid overwrites itself.
const doc = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint: "http://localhost:8000",
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  }),
);

export async function seedStoredIdentity(identity: {
  oid: string;
  email: string;
  displayName: string;
  lastSeenRoles: string[];
}): Promise<void> {
  await doc.send(
    new PutCommand({
      TableName: "bedrock-usage",
      Item: {
        PK: `IDENT#${identity.oid}`,
        SK: "META",
        gsi1pk: "IDENTS",
        gsi1sk: `IDENT#${identity.oid}`,
        oid: identity.oid,
        tid: "00000000-0000-4000-8000-0000000000b1",
        email: identity.email.toLowerCase(),
        displayName: identity.displayName,
        lastSignInAt: "2026-11-10T10:00:00.000Z",
        lastSeenRoles: identity.lastSeenRoles,
        authMethod: "entra",
        version: 1,
      },
    }),
  );
}

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

// Test-only seeding of stored Identity rows in the DynamoDB Local table the E2E
// dev server reads (playwright.config.ts: bedrock-usage on :8000). The dev
// login only signs in as a stored identity (Access Control - Dev login,
// amended L3c2). Lives under test/ because Rule 10.5 keeps @aws-sdk/* out of
// e2e/; imported by Playwright, so it must not pull in vitest.
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "dynamodb-local",
]);
const TABLE_NAME = "bedrock-usage";

function localEndpoint(): string {
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
  let hostname = "";
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    // an unparsable endpoint is refused below
  }
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Refusing to seed non-local DYNAMODB_ENDPOINT "${endpoint}": E2E seeding targets DynamoDB Local only.`,
    );
  }
  return endpoint;
}

let cached: DynamoDBDocumentClient | undefined;
function doc(): DynamoDBDocumentClient {
  cached ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: localEndpoint(),
      region: "us-east-1",
      // Dummy values DynamoDB Local requires - not real keys (Rule 50.1).
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
  return cached;
}

// Idempotent: the same oid overwrites itself.
export async function seedStoredIdentity(identity: {
  oid: string;
  email: string;
  displayName: string;
  lastSeenRoles: string[];
}): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE_NAME,
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

export async function deleteStoredIdentity(oid: string): Promise<void> {
  await doc().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `IDENT#${oid}`, SK: "META" },
    }),
  );
}

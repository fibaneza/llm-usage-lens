import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// Test-only seeding of a password user (identity row + stored password user)
// in the DynamoDB Local table the E2E dev server reads. Shapes follow
// lib/data/access/password-users.ts (createPasswordUser) and the identity row
// the password sign-in writes (Access Control - Password users, Identity).
// Lives under test/ because Rule 10.5 keeps @aws-sdk/* out of e2e/; imported
// by Playwright, so it must not pull in vitest or server-only modules.
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "dynamodb-local",
]);
const TABLE_NAME = "bedrock-usage";
// Not a credential: the route excludes the hash, so it must never appear in a
// response (spec - API routes, password-users).
const PLACEHOLDER_HASH = "e2e-placeholder-not-a-credential";

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

const userPk = (email: string) => `LOCALUSER#${email.toLowerCase()}`;

// Idempotent: the same oid and email overwrite themselves.
export async function seedStoredPasswordUser(user: {
  oid: string;
  email: string;
  displayName: string;
  expectedUpn: string;
  version: number;
  boundAt?: string;
}): Promise<void> {
  const email = user.email.toLowerCase();
  await doc().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `IDENT#${user.oid}`,
        SK: "META",
        gsi1pk: "IDENTS",
        gsi1sk: `IDENT#${user.oid}`,
        oid: user.oid,
        tid: "local",
        email,
        displayName: user.displayName,
        lastSignInAt: "2026-11-10T10:00:00.000Z",
        lastSeenRoles: [],
        authMethod: "password",
        version: 1,
      },
    }),
  );
  await doc().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: userPk(email),
        SK: "META",
        gsi1pk: "LOCALUSERS",
        gsi1sk: userPk(email),
        email,
        oid: user.oid,
        tid: "local",
        displayName: user.displayName,
        status: user.boundAt ? "sso-bound" : "enabled",
        version: user.version,
        sso: {
          expectedUpn: user.expectedUpn.toLowerCase(),
          ...(user.boundAt ? { boundAt: user.boundAt } : {}),
        },
        passwordHash: PLACEHOLDER_HASH,
        createdAt: "2026-11-10T10:00:00.000Z",
        updatedAt: "2026-11-10T10:00:00.000Z",
      },
    }),
  );
}

export async function deleteStoredPasswordUser(user: {
  oid: string;
  email: string;
}): Promise<void> {
  await doc().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `IDENT#${user.oid}`, SK: "META" },
    }),
  );
  await doc().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: userPk(user.email), SK: "META" },
    }),
  );
}

// Gives an identity row a UPN (lower-cased), as a real Entra sign-in does:
// "Make team lead" needs one (US2 ruling R2). The row must already exist.
export async function setStoredIdentityUpn(
  oid: string,
  upn: string,
): Promise<void> {
  await doc().send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `IDENT#${oid}`, SK: "META" },
      UpdateExpression: "SET #upn = :upn",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: { "#upn": "upn" },
      ExpressionAttributeValues: { ":upn": upn.toLowerCase() },
    }),
  );
}

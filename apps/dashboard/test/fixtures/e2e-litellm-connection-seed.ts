import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Test-only: removes the stored LiteLLM connection from the DynamoDB Local
// table the E2E dev server reads, so a spec that stored one can leave the
// table as it found it (PUT /api/litellm/connection has no DELETE; a leaked
// connection hides the "LiteLLM not configured" state from later specs -
// testing guide, E2E without LiteLLM). Lives under test/ because Rule 10.5
// keeps @aws-sdk/* out of e2e/; must not pull in vitest.
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "dynamodb-local",
]);

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
      `Refusing to touch non-local DYNAMODB_ENDPOINT "${endpoint}": E2E helpers target DynamoDB Local only.`,
    );
  }
  return endpoint;
}

export async function deleteStoredLiteLLMConnection(): Promise<void> {
  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint: localEndpoint(),
      region: "us-east-1",
      // Dummy values DynamoDB Local requires - not real keys (Rule 50.1).
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
  await doc.send(
    new DeleteCommand({
      TableName: "bedrock-usage",
      Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
    }),
  );
}

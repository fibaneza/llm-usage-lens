import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";

import { env } from "@/env";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (TOTP:
// "envelope-encrypted with a CMK data key"), threat T27; Platform spec — task
// role `kms:GenerateDataKey` / `kms:Decrypt` on the CMK. Lives under lib/data
// because Rule 10.5 confines AWS SDK imports there; lib/auth re-exports it.
// Format: v1.<encrypted data key>.<iv>.<tag>.<ciphertext>, all base64url.
const VERSION = "v1";
let client: KMSClient | undefined;

function kms(): { client: KMSClient; keyId: string } {
  const keyId = env.TOTP_KMS_KEY_ID;
  if (!keyId) throw new Error("TOTP_KMS_KEY_ID is not configured");
  client ??= new KMSClient({ region: env.AWS_REGION });
  return { client, keyId };
}

export async function encryptSecret(plain: string): Promise<string> {
  const { client: c, keyId } = kms();
  const dataKey = await c.send(
    new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: "AES_256" }),
  );
  if (!dataKey.Plaintext || !dataKey.CiphertextBlob) {
    throw new Error("KMS returned no data key");
  }
  const key = Buffer.from(dataKey.Plaintext);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [
      VERSION,
      Buffer.from(dataKey.CiphertextBlob).toString("base64url"),
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      body.toString("base64url"),
    ].join(".");
  } finally {
    key.fill(0);
  }
}

export async function decryptSecret(envelope: string): Promise<string> {
  const [version, wrapped, iv, tag, body] = envelope.split(".");
  if (version !== VERSION || !wrapped || !iv || !tag || !body) {
    throw new Error("unsupported secret envelope");
  }
  const { client: c, keyId } = kms();
  const res = await c.send(
    new DecryptCommand({
      KeyId: keyId,
      CiphertextBlob: Buffer.from(wrapped, "base64url"),
    }),
  );
  if (!res.Plaintext) throw new Error("KMS returned no plaintext");
  const key = Buffer.from(res.Plaintext);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } finally {
    key.fill(0);
  }
}

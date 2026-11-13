import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

type EnvMap = Record<string, string | undefined>;

type ApplyAppEnvFileInput = {
  dir: string;
  // Mutated: the effective environment (process.env in next.config.ts).
  processEnv: EnvMap;
  // The environment before Next loaded any .env file; undefined outside Next.
  initialEnv: EnvMap | undefined;
};

const APP_ENVS = ["dev", "prod"];

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

// Layers `.env.<APP_ENV>` (`.env.dev` / `.env.prod`) into Next's own .env
// loading, which keys only on NODE_ENV. Precedence, highest first: the real
// process environment, `.env.<NODE_ENV>.local`, `.env.local`,
// `.env.<APP_ENV>`, then `.env.<NODE_ENV>` and `.env`
// (implementation-phases spec — Environment Files). Returns what it applied.
export function applyAppEnvFile({
  dir,
  processEnv,
  initialEnv,
}: ApplyAppEnvFileInput): Record<string, string> {
  const appEnv = processEnv.APP_ENV;
  // The allowlist also keeps APP_ENV from naming an arbitrary path.
  if (appEnv === undefined || !APP_ENVS.includes(appEnv)) return {};

  const overlay = readEnvFile(join(dir, `.env.${appEnv}`));
  const pinned = initialEnv ?? processEnv;
  const local = {
    ...readEnvFile(join(dir, ".env.local")),
    ...(processEnv.NODE_ENV === undefined
      ? {}
      : readEnvFile(join(dir, `.env.${processEnv.NODE_ENV}.local`))),
  };

  const applied: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "APP_ENV" || key in pinned || key in local) continue;
    processEnv[key] = value;
    applied[key] = value;
  }
  return applied;
}

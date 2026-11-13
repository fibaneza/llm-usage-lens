// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyAppEnvFile } from "./env-files";

// Source: implementation-phases spec — Environment Files (precedence of
// `.env.<APP_ENV>` between `.env.local` and `.env`).

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "env-files-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string) {
  writeFileSync(join(dir, name), contents);
}

describe("applyAppEnvFile", () => {
  it("applies .env.dev over values that came from .env", () => {
    write(".env.dev", "AUTH_DEV_LOGIN=true\nNEXT_PUBLIC_ORG_NAME=Dev\n");
    const processEnv = { APP_ENV: "dev", NEXT_PUBLIC_ORG_NAME: "Base" };

    const applied = applyAppEnvFile({ dir, processEnv, initialEnv: {} });

    expect(applied).toEqual({
      AUTH_DEV_LOGIN: "true",
      NEXT_PUBLIC_ORG_NAME: "Dev",
    });
    expect(processEnv).toMatchObject(applied);
  });

  it("selects the file by APP_ENV", () => {
    write(".env.dev", "NEXT_PUBLIC_ORG_NAME=Dev\n");
    write(".env.prod", "NEXT_PUBLIC_ORG_NAME=Prod\n");
    const processEnv: Record<string, string> = { APP_ENV: "prod" };

    applyAppEnvFile({ dir, processEnv, initialEnv: {} });

    expect(processEnv.NEXT_PUBLIC_ORG_NAME).toBe("Prod");
  });

  it("never overrides the real process environment, even an empty value", () => {
    write(".env.dev", "AUTH_MICROSOFT_ENTRA_ID_ID=from-file\n");
    const processEnv = { APP_ENV: "dev", AUTH_MICROSOFT_ENTRA_ID_ID: "" };

    const applied = applyAppEnvFile({
      dir,
      processEnv,
      initialEnv: { AUTH_MICROSOFT_ENTRA_ID_ID: "" },
    });

    expect(applied).toEqual({});
    expect(processEnv.AUTH_MICROSOFT_ENTRA_ID_ID).toBe("");
  });

  it("keeps .env.local and .env.<NODE_ENV>.local above .env.<APP_ENV>", () => {
    write(".env.dev", "A=dev\nB=dev\nC=dev\n");
    write(".env.local", "A=local\n");
    write(".env.development.local", "B=dev-local\n");
    const processEnv: Record<string, string> = {
      APP_ENV: "dev",
      NODE_ENV: "development",
      A: "local",
      B: "dev-local",
    };

    const applied = applyAppEnvFile({ dir, processEnv, initialEnv: {} });

    expect(applied).toEqual({ C: "dev" });
    expect(processEnv).toMatchObject({ A: "local", B: "dev-local", C: "dev" });
  });

  it("treats every existing variable as pinned when Next has not loaded env", () => {
    write(".env.dev", "A=dev\nB=dev\n");
    const processEnv: Record<string, string> = { APP_ENV: "dev", A: "set" };

    const applied = applyAppEnvFile({
      dir,
      processEnv,
      initialEnv: undefined,
    });

    expect(applied).toEqual({ B: "dev" });
    expect(processEnv.A).toBe("set");
  });

  it("does not let the file change APP_ENV", () => {
    write(".env.dev", "APP_ENV=prod\n");
    const processEnv = { APP_ENV: "dev" };

    applyAppEnvFile({ dir, processEnv, initialEnv: {} });

    expect(processEnv.APP_ENV).toBe("dev");
  });

  it.each([undefined, "", "staging", "../secrets"])(
    "loads nothing when APP_ENV is %j",
    (appEnv) => {
      write(".env.staging", "A=1\n");
      const processEnv: Record<string, string | undefined> = {
        APP_ENV: appEnv,
      };

      expect(applyAppEnvFile({ dir, processEnv, initialEnv: {} })).toEqual({});
      expect(processEnv.A).toBeUndefined();
    },
  );

  it("loads nothing when the file is missing", () => {
    const processEnv = { APP_ENV: "dev" };

    expect(applyAppEnvFile({ dir, processEnv, initialEnv: {} })).toEqual({});
  });
});

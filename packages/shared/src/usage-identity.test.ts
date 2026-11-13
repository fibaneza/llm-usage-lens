import { describe, expect, it } from "vitest";

import { canonicalUsageIdentity, canonicaliseByUser } from "./usage-identity";

// Source: docs/specs/2026-11-10-access-control.md — "Canonical usage
// identity"; Rule 20.14. Contract R2 §3 and decision 20.
const entry = (n: number, estimated = true) => ({
  cost: n,
  inputTokens: n * 10,
  outputTokens: n * 5,
  invocations: n,
  costEstimated: estimated,
});

describe("canonicalUsageIdentity", () => {
  it("takes the email after the last slash of an SSO assumed-role ARN", () => {
    expect(
      canonicalUsageIdentity(
        "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_X_Y/Jane.Doe@Company.com",
      ),
    ).toEqual({ kind: "person", key: "jane.doe@company.com" });
  });

  it("takes the email after the last colon of a principal id", () => {
    expect(canonicalUsageIdentity("AROAEXAMPLE:jane.doe@company.com")).toEqual({
      kind: "person",
      key: "jane.doe@company.com",
    });
  });

  it("trims and lower-cases a bare email", () => {
    expect(canonicalUsageIdentity("  Jane@Company.COM ")).toEqual({
      kind: "person",
      key: "jane@company.com",
    });
  });

  it("keeps a non-email session name raw as non-person", () => {
    expect(canonicalUsageIdentity("ci-pipeline-session")).toEqual({
      kind: "non-person",
      key: "ci-pipeline-session",
    });
  });

  it("keeps the raw key for an invalid email", () => {
    const raw = "arn:aws:sts::1:assumed-role/R/not@";
    expect(canonicalUsageIdentity(raw)).toEqual({
      kind: "non-person",
      key: raw,
    });
  });
});

describe("canonicaliseByUser", () => {
  it("re-keys by canonical identity", () => {
    const out = canonicaliseByUser({
      "AROAEXAMPLE:Jane@Company.com": entry(1),
    });
    expect(Object.keys(out)).toEqual(["jane@company.com"]);
  });

  it("sums the numbers of keys that canonicalise together", () => {
    const out = canonicaliseByUser({
      "jane@company.com": entry(1),
      "AROAEXAMPLE:JANE@company.com": entry(2),
    });
    expect(Object.keys(out)).toEqual(["jane@company.com"]);
    expect(out["jane@company.com"]).toMatchObject({
      cost: 3,
      inputTokens: 30,
      outputTokens: 15,
      invocations: 3,
    });
  });

  it("leaves non-person keys untouched and returns {} for {}", () => {
    expect(Object.keys(canonicaliseByUser({ svc: entry(1) }))).toEqual(["svc"]);
    expect(canonicaliseByUser({})).toEqual({});
  });
});

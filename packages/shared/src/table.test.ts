import { describe, expect, it } from "vitest";

import {
  GSI1_NAME,
  META_SK,
  SYNC_SK,
  SYSTEM_PK,
  TABLE_NAME_DEFAULT,
  accountPk,
  dailySk,
  datePk,
  deptPk,
} from "./table";

import * as shared from "./index";

// Source: docs/specs/2026-05-15-data-model.md — "Table Definition" + "Entity Map".
describe("table key builders", () => {
  it("exposes the table and index names", () => {
    expect(TABLE_NAME_DEFAULT).toBe("bedrock-usage");
    expect(GSI1_NAME).toBe("GSI1");
  });

  it("builds account partition keys", () => {
    expect(accountPk("123456789012")).toBe("ACCT#123456789012");
  });

  it("uses the META sort key for AccountMeta", () => {
    expect(META_SK).toBe("META");
  });

  it("builds DailyRollup sort keys from a UTC day", () => {
    expect(dailySk("2026-05-15")).toBe("DAILY#2026-05-15");
  });

  it("builds GSI1 partition keys for dates and departments", () => {
    expect(datePk("2026-05-15")).toBe("DATE#2026-05-15");
    expect(deptPk("dept-engineering")).toBe("DEPT#dept-engineering");
  });

  it("uses the SYSTEM / SYNC#LATEST keys for SyncStatus", () => {
    expect(SYSTEM_PK).toBe("SYSTEM");
    expect(SYNC_SK).toBe("SYNC#LATEST");
  });

  it("is re-exported from the @llm-usage-lens/shared entry point", () => {
    expect(shared.accountPk("000000000001")).toBe("ACCT#000000000001");
    expect(shared.dailySk("2026-01-02")).toBe("DAILY#2026-01-02");
    expect(shared.TABLE_NAME_DEFAULT).toBe("bedrock-usage");
  });
});

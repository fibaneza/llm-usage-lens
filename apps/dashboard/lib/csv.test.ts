import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";

// Implementation-phases Phase 4.2: "CSV exports correctly". The export follows
// RFC 4180: a field containing a comma, a double quote or a line break is
// wrapped in double quotes and embedded quotes are doubled. Numbers are written
// raw (no currency symbol, no thousands separator) so the file re-imports as
// numbers.
type Row = { name: string; cost: number; tokens: number };

const columns = [
  { header: "Name", value: (r: Row) => r.name },
  { header: "Cost", value: (r: Row) => r.cost },
  { header: "Tokens", value: (r: Row) => r.tokens },
];

// Record separator is CRLF per RFC 4180; LF is accepted too, and a trailing
// terminator is optional.
function lines(csv: string): string[] {
  return csv.replace(/\r?\n$/, "").split(/\r?\n/);
}

describe("toCsv", () => {
  it("writes the header row first, then one row per record in order", () => {
    const csv = toCsv(columns, [
      { name: "Alpha", cost: 12.5, tokens: 1000 },
      { name: "Bravo", cost: 3, tokens: 50 },
    ]);

    expect(lines(csv)).toEqual([
      "Name,Cost,Tokens",
      "Alpha,12.5,1000",
      "Bravo,3,50",
    ]);
  });

  it("writes only the header row when there are no records", () => {
    expect(lines(toCsv(columns, []))).toEqual(["Name,Cost,Tokens"]);
  });

  it("writes numbers raw, with no currency symbol or thousands separator", () => {
    const csv = toCsv(columns, [
      { name: "Big", cost: 1234567.891, tokens: 9876543210 },
      { name: "Zero", cost: 0, tokens: 0 },
      { name: "Negative", cost: -4.25, tokens: 0 },
    ]);

    expect(lines(csv)).toEqual([
      "Name,Cost,Tokens",
      "Big,1234567.891,9876543210",
      "Zero,0,0",
      "Negative,-4.25,0",
    ]);
  });

  it("leaves a plain field unquoted", () => {
    const csv = toCsv(columns, [{ name: "Plain name", cost: 1, tokens: 1 }]);

    expect(lines(csv)[1]).toBe("Plain name,1,1");
  });

  it("quotes a field that contains a comma", () => {
    const csv = toCsv(columns, [{ name: "Acme, Inc", cost: 1, tokens: 2 }]);

    expect(lines(csv)[1]).toBe('"Acme, Inc",1,2');
  });

  it("quotes a field that contains a double quote and doubles the quote", () => {
    const csv = toCsv(columns, [{ name: 'The "big" one', cost: 1, tokens: 2 }]);

    expect(lines(csv)[1]).toBe('"The ""big"" one",1,2');
  });

  it("quotes a field that contains a line break and keeps the break inside the quotes", () => {
    const csv = toCsv(columns, [{ name: "line1\nline2", cost: 1, tokens: 2 }]);

    expect(csv).toContain('"line1\nline2",1,2');
  });

  it("writes an empty string as an empty field", () => {
    const csv = toCsv(columns, [{ name: "", cost: 1, tokens: 2 }]);

    expect(lines(csv)[1]).toBe(",1,2");
  });

  it("quotes a header that needs it", () => {
    const csv = toCsv(
      [{ header: "Cost, USD", value: (r: Row) => r.cost }],
      [{ name: "x", cost: 5, tokens: 0 }],
    );

    expect(lines(csv)).toEqual(['"Cost, USD"', "5"]);
  });

  // OWASP CSV injection: a text field a spreadsheet would run as a formula is
  // prefixed with an apostrophe (review round 1 W6; exports carry userId and
  // service tags).
  it.each(["=SUM(A1)", "+1", "-1+2", "@cmd", "\tx", "\rx"])(
    "prefixes a field starting with a formula character (%j) with an apostrophe",
    (name) => {
      const csv = toCsv(columns, [{ name, cost: 1, tokens: 2 }]);

      expect(csv).toContain(`'${name}`);
    },
  );

  it("prefixes before quoting, so a formula field with a comma stays one quoted field", () => {
    const csv = toCsv(columns, [{ name: "=A1,B1", cost: 1, tokens: 2 }]);

    expect(lines(csv)[1]).toBe(`"'=A1,B1",1,2`);
  });

  it("neutralises a formula-looking header too", () => {
    const csv = toCsv(
      [{ header: "=evil", value: (r: Row) => r.cost }],
      [{ name: "x", cost: 5, tokens: 0 }],
    );

    expect(lines(csv)[0]).toBe("'=evil");
  });

  it("leaves ordinary fields, mid-field formula characters and numbers unchanged", () => {
    const csv = toCsv(columns, [
      { name: "a=b", cost: -1.5, tokens: 2 },
      { name: "user@example.com", cost: 0, tokens: 0 },
    ]);

    expect(lines(csv).slice(1)).toEqual(["a=b,-1.5,2", "user@example.com,0,0"]);
  });
});

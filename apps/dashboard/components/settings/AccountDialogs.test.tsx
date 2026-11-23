import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountMeta } from "@llm-usage-lens/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { AddAccountDialog } from "./AccountDialogs";

// Source: D-ST5; Design System - "Settings
// small UX" > "Add account"; Data Model - "API Routes" /api/accounts POST (the
// server generates departmentId and teamId; the body is strict, so the form
// must never send them). Module under test:
// `components/settings/AccountDialogs.tsx` <AddAccountDialog onClose />.
const EXISTING: AccountMeta = {
  accountId: "123456789012",
  accountName: "Payments Prod",
  departmentId: "engineering",
  departmentName: "Engineering",
  teamId: "payments",
  teamName: "Payments",
  region: "ap-southeast-2",
  active: true,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

type Call = { method: string; path: string; body: unknown };

function stubApi() {
  const writes: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      if (method === "GET") return apiResponse({ data: [EXISTING] });
      writes.push({
        method,
        path,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return apiResponse({ data: EXISTING });
    }),
  );
  return writes;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.type(
    within(dialog).getByLabelText("AWS account ID"),
    "000000000000",
  );
  await user.type(
    within(dialog).getByLabelText(/^account name/i),
    "New Account",
  );
  await user.type(
    within(dialog).getByLabelText(/^department name/i),
    "Data Science",
  );
  await user.type(within(dialog).getByLabelText(/^team name/i), "ML");
  await user.click(
    within(dialog).getByRole("button", { name: "Create account" }),
  );
}

describe("AddAccountDialog (D-ST5)", () => {
  it("shows 'AWS account ID' and no Department ID / Team ID input", () => {
    stubApi();
    renderWithProviders(<AddAccountDialog onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("AWS account ID")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/department id/i)).toBeNull();
    expect(within(dialog).queryByLabelText(/team id/i)).toBeNull();
  });

  it("POSTs the names and no departmentId or teamId typed by the person", async () => {
    const writes = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<AddAccountDialog onClose={() => {}} />);
    await fillAndSubmit(user, screen.getByRole("dialog"));

    await waitFor(() => expect(writes).toHaveLength(1));
    const body = writes[0]?.body as Record<string, unknown>;
    expect(writes[0]?.path).toBe("/api/accounts");
    expect(body).toMatchObject({
      accountId: "000000000000",
      accountName: "New Account",
      departmentName: "Data Science",
      teamName: "ML",
      region: "ap-southeast-2",
    });
    expect(body).not.toHaveProperty("departmentId");
    expect(body).not.toHaveProperty("teamId");
  });

  it("rejects an account ID that is not 12 digits and sends nothing", async () => {
    const writes = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<AddAccountDialog onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("AWS account ID"), "12345");
    await user.type(within(dialog).getByLabelText(/^account name/i), "X");
    await user.type(within(dialog).getByLabelText(/^department name/i), "D");
    await user.type(within(dialog).getByLabelText(/^team name/i), "T");
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );
    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("picking an existing department sends its name, never its id", async () => {
    const writes = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<AddAccountDialog onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("AWS account ID"),
      "000000000000",
    );
    await user.type(within(dialog).getByLabelText(/^account name/i), "Second");
    await user.type(within(dialog).getByLabelText(/^team name/i), "ML");
    const pick = await within(dialog).findByLabelText(/existing department/i);
    await user.selectOptions(pick, "Engineering");
    await user.click(
      within(dialog).getByRole("button", { name: "Create account" }),
    );

    await waitFor(() => expect(writes).toHaveLength(1));
    const body = writes[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ departmentName: "Engineering" });
    expect(body).not.toHaveProperty("departmentId");
    expect(body).not.toHaveProperty("teamId");
  });
});

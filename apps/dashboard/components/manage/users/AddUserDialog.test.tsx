import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { AddUserDialog } from "./AddUserDialog";

// Source: Design System - Management improvements, Users (D15; agent decision
// 2026-11-18): Add user runs step 1 (a password user, pre-SSO, internal-admin)
// then step 2 (a pending member by email) in one submit; a step is present
// only when the caller's flags allow it, so an org-admin sees the team step
// only and under Entra there is no password step; the setup link is shown once;
// step 3 is the row's LiteLLM link action. The routes decide each permission
// again (their own tests, Rule 60.24a).
const stepUp = { entra: vi.fn(), credentials: vi.fn(), devLogin: vi.fn() };

type Call = { url: string; method: string; body: unknown };
function stub(failMembers = false) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      calls.push({
        url: url.pathname,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.pathname === "/api/access/org-units") {
        return Promise.resolve(
          apiResponse({
            data: {
              departments: [],
              teams: [{ id: "team-a", name: "Team A", departmentId: "d" }],
            },
          }),
        );
      }
      if (url.pathname === "/api/password-users") {
        return Promise.resolve(
          apiResponse({ data: { setupLink: "https://app.example/setup/abc" } }),
        );
      }
      if (failMembers) {
        return Promise.resolve(
          apiResponse(
            { error: { code: "NOT_FOUND", message: "no team" } },
            404,
          ),
        );
      }
      return Promise.resolve(apiResponse({ data: {} }));
    }),
  );
  return calls;
}

function open(steps: { password: boolean; team: boolean; link: boolean }) {
  const onWritten = vi.fn();
  renderWithProviders(
    <AddUserDialog
      steps={steps}
      authMethod="entra"
      stepUp={stepUp}
      onClose={vi.fn()}
      onWritten={onWritten}
    />,
  );
  return onWritten;
}

const submit = () =>
  userEvent.setup().click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Add user",
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddUserDialog steps (D15)", () => {
  it("admin before SSO: password step (on) and a team step", async () => {
    stub();
    open({ password: true, team: true, link: true });
    expect(screen.getByLabelText("Create a password sign-in")).toBeChecked();
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(await screen.findByLabelText("Team (optional)")).toBeInTheDocument();
  });

  it("org-admin or Entra: no password step, and the team is required", async () => {
    stub();
    open({ password: false, team: true, link: true });
    expect(screen.queryByLabelText("Create a password sign-in")).toBeNull();
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(screen.getByLabelText("Team")).toBeInTheDocument();
  });

  it("an invalid email writes nothing", async () => {
    const calls = stub();
    open({ password: false, team: true, link: true });
    await userEvent
      .setup()
      .type(screen.getByLabelText("Work email"), "not-an-email");
    await submit();
    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("the team step alone needs a team before it writes", async () => {
    const calls = stub();
    open({ password: false, team: true, link: true });
    await userEvent
      .setup()
      .type(screen.getByLabelText("Work email"), "dee@example.com");
    await submit();
    expect(await screen.findByText("Choose a team")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });
});

describe("AddUserDialog writes (D15)", () => {
  it("org-admin: adds a pending member by email, and never calls the password route", async () => {
    const calls = stub();
    const onWritten = open({ password: false, team: true, link: true });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Work email"), "dee@example.com");
    await user.selectOptions(await screen.findByLabelText("Team"), "team-a");
    await submit();
    await waitFor(() => expect(onWritten).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      {
        url: "/api/teams/team-a/members",
        method: "POST",
        body: { emailOrUpn: "dee@example.com" },
      },
    ]);
    expect(
      await screen.findByText(/added as a pending member/i),
    ).toBeInTheDocument();
  });

  it("admin: creates the password user first, shows the setup link once, then adds the member", async () => {
    const calls = stub();
    open({ password: true, team: true, link: true });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Work email"), "dee@example.com");
    await user.type(screen.getByLabelText("Display name"), "Dee Dee");
    await user.selectOptions(
      await screen.findByLabelText("Team (optional)"),
      "team-a",
    );
    await submit();
    expect(
      await screen.findByDisplayValue("https://app.example/setup/abc"),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual([
      "/api/password-users",
      "/api/teams/team-a/members",
    ]);
    expect(calls.find((c) => c.url === "/api/password-users")?.body).toEqual({
      email: "dee@example.com",
      displayName: "Dee Dee",
    });
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
  });

  it("a team-step failure after the password user keeps the setup link and reports the failure", async () => {
    stub(true);
    open({ password: true, team: true, link: true });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Work email"), "dee@example.com");
    await user.type(screen.getByLabelText("Display name"), "Dee Dee");
    await user.selectOptions(
      await screen.findByLabelText("Team (optional)"),
      "team-a",
    );
    await submit();
    expect(
      await screen.findByText(/the team step failed/i),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://app.example/setup/abc"),
    ).toBeInTheDocument();
  });
});

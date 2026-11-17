import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import {
  HIDDEN,
  ME_ADMIN,
  ORG_NOT_CONFIGURED,
  ORG_WARN,
  orgShow,
  stubRoutes,
} from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { CombinedOrganisationSection } from "./CombinedOrganisationSection";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears (Overview: "a Combined usage section under
// the KPI row - organisation combined with its parts, 'Billed via LiteLLM'
// (the gateway slice), LiteLLM spend by provider, the reconciliation row"),
// Organisation read ("LiteLLM teams only" - spend on keys outside any team is
// not in the total), UI pieces ("the reconciliation states its sign in words
// '$0.20 more billed than reported'"), States (LD37; gateway not configured;
// 503 -> that section's ErrorBoundary only), Visibility; Design System Rule
// 40.4 / 60.12 (own Suspense + ErrorBoundary). Counted-once fixture: combined
// 16.20 = direct 10 + LiteLLM 6.20, slice 5, reconciliation -0.20.
// Module under test: `components/litellm/combined/CombinedOrganisationSection.tsx`
//   <CombinedOrganisationSection range={{ dateFrom, dateTo }} />   (client)
// GET /api/litellm/combined/organisation?dateFrom=&dateTo= (schema:
// CombinedOrganisationResponseSchema). Contract:
//   - loading: a skeleton and NO named region
//   - loaded (show|warn|LD37): region "Combined usage" with an h2 of that name
//   - hidden: nothing at all after loading
//   - rows/text: CombinedFigure + exact "Billed via LiteLLM $5.00" +
//     "$0.20 less billed than reported" / "more billed than reported" /
//     "Billed and reported match" (abs difference; sign in words) with the
//     percentage as "4.0%" when differencePct is not null; the note
//     "LiteLLM teams only"; the section has its own SectionBoundary titled
//     "combined usage" ("Couldn't load combined usage.")
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PATH = "/api/litellm/combined/organisation";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CombinedOrganisationSection", () => {
  it("requests the organisation route for the given UTC range", async () => {
    const { urls } = stubRoutes({ [PATH]: orgShow() });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    await screen.findByRole("region", { name: "Combined usage" });
    expect(urls[0]?.pathname).toBe(PATH);
    expect(urls[0]?.searchParams.get("dateFrom")).toBe("2026-01-11");
    expect(urls[0]?.searchParams.get("dateTo")).toBe("2026-01-20");
  });

  it("shows a skeleton and no named region while loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const view = renderWithProviders(
      <CombinedOrganisationSection range={RANGE} />,
    );
    expect(
      view.container.querySelector('[data-slot="skeleton"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Combined usage" })).toBeNull();
  });

  it("show: combined with parts, the gateway slice, the sign in words and the LiteLLM-teams-only note", async () => {
    stubRoutes({ [PATH]: orgShow() });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined usage",
    });
    expect(within(region).getByTestId("combined-total")).toHaveTextContent(
      "$16.20",
    );
    expect(
      within(region).getByText("Direct Bedrock $10.00 · Via LiteLLM $6.20"),
    ).toBeInTheDocument();
    expect(
      within(region).getByText("Billed via LiteLLM $5.00"),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/\$0\.20 less billed than reported/),
    ).toBeInTheDocument();
    expect(within(region).getByText(/4\.0%/)).toBeInTheDocument();
    expect(within(region).getByText(/LiteLLM teams only/)).toBeInTheDocument();
    expect(within(region).queryByRole("status")).toBeNull();
  });

  it("lists LiteLLM spend by provider behind the disclosure", async () => {
    stubRoutes({ [PATH]: orgShow() });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    const toggle = await screen.findByRole("button", {
      name: "Provider split",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("bedrock"),
      expect.stringContaining("openai"),
    ]);
  });

  it.each([
    [0.2, "$0.20 more billed than reported"],
    [-0.2, "$0.20 less billed than reported"],
    [0, "Billed and reported match"],
  ])("reconciliation difference %s reads %j", async (difference, words) => {
    stubRoutes({
      [PATH]: orgShow({
        reconciliation: {
          litellmBedrock: 5,
          difference,
          differencePct: difference / 5,
        },
      }),
    });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    expect(
      await screen.findByText(new RegExp(words.replace(/\$/g, "\\$"))),
    ).toBeInTheDocument();
  });

  it("no reconciliation (null) and a null percentage render without the row or the percentage", async () => {
    stubRoutes({ [PATH]: orgShow({ reconciliation: null }) });
    const first = renderWithProviders(
      <CombinedOrganisationSection range={RANGE} />,
    );
    await screen.findByRole("region", { name: "Combined usage" });
    expect(screen.queryByText(/billed than reported/)).toBeNull();
    first.unmount();

    stubRoutes({
      [PATH]: orgShow({
        reconciliation: {
          litellmBedrock: 0.2,
          difference: -0.2,
          differencePct: null,
        },
      }),
    });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    expect(
      await screen.findByText(/\$0\.20 less billed than reported/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("warn: the exact warning text, an Admin link to the Gateway sub-tab and the figures", async () => {
    stubRoutes({ [PATH]: ORG_WARN, "/api/me": ME_ADMIN });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined usage",
    });
    expect(within(region).getByRole("status")).toHaveTextContent(
      "gateway not configured — totals may double count",
    );
    expect(
      await within(region).findByRole("link", {
        name: "Configure the gateway",
      }),
    ).toHaveAttribute("href", "/dashboard/settings/litellm/gateway");
    expect(within(region).getByTestId("combined-total")).toHaveTextContent(
      "$21.20",
    );
  });

  it("warn for an Auditor: the warning without the link", async () => {
    stubRoutes({
      [PATH]: ORG_WARN,
      "/api/me": { ...ME_ADMIN, roles: ["internal-auditor"] },
    });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined usage",
    });
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(within(region).queryByRole("link")).toBeNull();
  });

  it("LD37 LiteLLM not configured: says so, shows the Bedrock part and no combined figure", async () => {
    stubRoutes({ [PATH]: ORG_NOT_CONFIGURED });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined usage",
    });
    expect(
      within(region).getByText("LiteLLM not configured"),
    ).toBeInTheDocument();
    expect(within(region).queryByTestId("combined-total")).toBeNull();
    expect(within(region).queryByText(/Via LiteLLM/)).toBeNull();
    expect(within(region).getByText(/\$15\.00/)).toBeInTheDocument();
  });

  it("hidden: renders nothing once loaded", async () => {
    stubRoutes({ [PATH]: HIDDEN });
    const view = renderWithProviders(
      <CombinedOrganisationSection range={RANGE} />,
    );
    await waitFor(() =>
      expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull(),
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText(/Direct Bedrock/)).toBeNull();
  });

  it("a 503 LITELLM_UNAVAILABLE is this section's error state only", async () => {
    stubRoutes({
      [PATH]: () =>
        apiResponse(
          { error: { code: "LITELLM_UNAVAILABLE", message: "unavailable" } },
          503,
        ),
    });
    renderWithProviders(<CombinedOrganisationSection range={RANGE} />);
    expect(
      await screen.findByText("Couldn't load combined usage."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from "@testing-library/react";
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

import { SourceFigures } from "./SourceFigures";

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (D18: three figures Bedrock | LiteLLM | Combined; Combined
// is L6's `combined`, shows its parts and the estimate mark, and follows the
// gateway-not-configured rule; M5-D7: hidden draws neither card, not
// configured is "Not configured" with no Combined card); LiteLLM spec - L6
// States and LT-MI4 (the counted-once fixture: combined 16.20 is NOT
// bedrockExact 15 + litellm 6.20); implementation-phases M5 Verify (the three
// figures; warning; a LiteLLM outage leaves the Bedrock figure working).
// Module under test: `components/litellm/combined/SourceFigures.tsx`
//   <SourceFigures range bedrock={node} />  (client); one request to
//   GET /api/litellm/combined/organisation.
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PATH = "/api/litellm/combined/organisation";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderFigures() {
  return renderWithProviders(
    <SourceFigures
      range={RANGE}
      bedrock={<div data-testid="source-figure-bedrock">Bedrock slot</div>}
    />,
  );
}

describe("SourceFigures -- the three figures (D18)", () => {
  it("shows the Bedrock slot, the LiteLLM figure and the Combined figure with its parts", async () => {
    const { urls } = stubRoutes({ [PATH]: orgShow() });
    renderFigures();

    const group = screen.getByRole("group", { name: "Source totals" });
    const litellm = await screen.findByTestId("source-figure-litellm");
    expect(
      within(group).getByTestId("source-figure-bedrock"),
    ).toHaveTextContent("Bedrock slot");
    expect(litellm).toHaveTextContent("$6.20");
    expect(litellm).toHaveTextContent(/LiteLLM-reported/);

    const combined = screen.getByTestId("source-figure-combined");
    expect(within(combined).getByTestId("combined-total")).toHaveTextContent(
      "$16.20",
    );
    expect(
      within(combined).getByText("Direct Bedrock $10.00 · Via LiteLLM $6.20"),
    ).toBeInTheDocument();
    expect(urls.map((u) => u.pathname)).toEqual([PATH]);
    expect(urls[0]?.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(urls[0]?.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });

  it("LT-MI4: Combined is the server's combined (counted once), never Bedrock plus LiteLLM", async () => {
    // bedrockExact 15 + litellm 6.20 = 21.20, but the gateway slice (5) is
    // counted once, so combined is 16.20.
    stubRoutes({ [PATH]: orgShow() });
    renderFigures();
    const combined = await screen.findByTestId("source-figure-combined");
    expect(within(combined).getByTestId("combined-total")).toHaveTextContent(
      "$16.20",
    );
    expect(combined).not.toHaveTextContent("$21.20");
  });

  it("marks the Combined figure as including estimates (Rule 20.3)", async () => {
    stubRoutes({ [PATH]: orgShow({ costEstimated: true }) });
    renderFigures();
    const combined = await screen.findByTestId("source-figure-combined");
    expect(within(combined).getByText("Includes estimates")).toBeVisible();
  });
});

describe("SourceFigures -- states", () => {
  it("warn (no gateway): the status text above the figures, and the total still shown to a global reader", async () => {
    stubRoutes({ [PATH]: ORG_WARN, "/api/me": ME_ADMIN });
    renderFigures();
    const combined = await screen.findByTestId("source-figure-combined");
    expect(screen.getByRole("status")).toHaveTextContent(
      "gateway not configured — totals may double count",
    );
    expect(within(combined).getByTestId("combined-total")).toHaveTextContent(
      "$21.20",
    );
  });

  it("hidden (M5-D7): neither the LiteLLM nor the Combined figure; the Bedrock slot stays", async () => {
    stubRoutes({ [PATH]: HIDDEN });
    const view = renderFigures();
    await waitFor(() =>
      expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull(),
    );
    expect(screen.queryByTestId("source-figure-litellm")).toBeNull();
    expect(screen.queryByTestId("source-figure-combined")).toBeNull();
    expect(screen.getByTestId("source-figure-bedrock")).toBeInTheDocument();
  });

  it("not configured (M5-D7, L6 States): LiteLLM reads Not configured and there is no Combined figure", async () => {
    stubRoutes({ [PATH]: ORG_NOT_CONFIGURED });
    renderFigures();
    const litellm = await screen.findByTestId("source-figure-litellm");
    expect(litellm).toHaveTextContent("Not configured");
    expect(screen.queryByTestId("source-figure-combined")).toBeNull();
    expect(screen.queryByTestId("combined-total")).toBeNull();
  });

  it("a 503 LITELLM_UNAVAILABLE stays in the LiteLLM boundary; the Bedrock figure keeps working (D17)", async () => {
    stubRoutes({
      [PATH]: () =>
        apiResponse(
          { error: { code: "LITELLM_UNAVAILABLE", message: "unavailable" } },
          503,
        ),
    });
    renderFigures();
    expect(
      await screen.findByText("Couldn't load the LiteLLM and combined totals."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("source-figure-bedrock")).toHaveTextContent(
      "Bedrock slot",
    );
  });
});

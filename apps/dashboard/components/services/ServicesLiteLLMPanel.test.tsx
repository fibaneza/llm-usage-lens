import { screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import {
  HIDDEN,
  ORG_NOT_CONFIGURED,
  orgShow,
  stubRoutes,
} from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { ServicesLiteLLMPanel } from "./ServicesLiteLLMPanel";

// Source: Design System - "Source panels ..." D19 (honest gaps: LiteLLM
// reports no cost by service, so the panel shows the LiteLLM total for the
// range, its split by provider from L6's byProvider[] and the line "LiteLLM
// does not report cost by service."; it never maps a key alias or tag to a
// service) and Q7 = no (user, 2026-11-17); M5-D6, M5-D7.
// Module under test: `components/services/ServicesLiteLLMPanel.tsx`
//   <ServicesLiteLLMPanel range={{ dateFrom, dateTo }} />  (client; reads
//   GET /api/litellm/combined/organisation).
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PATH = "/api/litellm/combined/organisation";
const GAP = "LiteLLM does not report cost by service.";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel() {
  return renderWithProviders(
    <Suspense fallback={<p>loading</p>}>
      <ServicesLiteLLMPanel range={RANGE} />
    </Suspense>,
  );
}

describe("ServicesLiteLLMPanel (D19)", () => {
  it("shows the gap line, the LiteLLM total and the provider split, and no service rows", async () => {
    const { urls } = stubRoutes({ [PATH]: orgShow() });
    renderPanel();
    expect(await screen.findByText("LiteLLM total $6.20")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(GAP);
    const table = screen.getByRole("table", {
      name: "LiteLLM spend by provider",
    });
    const text = within(table)
      .getAllByRole("row")
      .map((r) => r.textContent)
      .join("|");
    expect(text).toMatch(/bedrock.*\$5\.20/);
    expect(text).toMatch(/openai.*\$1\.00/);
    expect(within(table).queryByText("Service")).toBeNull();
    expect(urls.map((u) => u.pathname)).toEqual([PATH]);
  });

  it("no gateway (warn): the gap line and the total still show", async () => {
    stubRoutes({
      [PATH]: orgShow({ visibility: "warn", gatewayConfigured: false }),
    });
    renderPanel();
    expect(await screen.findByText("LiteLLM total $6.20")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(GAP);
  });

  it("not configured: the gap line and 'LiteLLM not configured', no table", async () => {
    stubRoutes({ [PATH]: ORG_NOT_CONFIGURED });
    renderPanel();
    expect(await screen.findByText("LiteLLM not configured")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(GAP);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("hidden: only the gap line", async () => {
    stubRoutes({ [PATH]: HIDDEN });
    renderPanel();
    expect(await screen.findByRole("note")).toHaveTextContent(GAP);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/LiteLLM total/)).toBeNull();
  });

  it("a 503 stays in this panel's boundary", async () => {
    stubRoutes({
      [PATH]: () =>
        apiResponse(
          { error: { code: "LITELLM_UNAVAILABLE", message: "down" } },
          503,
        ),
    });
    renderPanel();
    expect(
      await screen.findByText("Couldn't load the LiteLLM figures."),
    ).toBeVisible();
  });
});

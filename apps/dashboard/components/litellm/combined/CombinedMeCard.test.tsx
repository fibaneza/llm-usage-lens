import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { HIDDEN, personShow, stubRoutes } from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { CombinedMeCard } from "./CombinedMeCard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears (My usage: 'a "Your combined usage" card
// above the existing Bedrock and LiteLLM sections; per Visibility'), Routes
// (GET /api/litellm/combined/me, any signed-in role), Visibility (a Viewer or
// Lead: show when the gateway is configured, else hidden - no card). The card
// states are tested once in CombinedPersonCard.test.tsx; this file tests the
// wiring only (Rule 60.24a).
// Module under test: `components/litellm/combined/CombinedMeCard.tsx`
//   <CombinedMeCard range={{ dateFrom, dateTo }} />   (client; fetches and
//   renders <CombinedPersonCard title="Your combined usage" />)
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PATH = "/api/litellm/combined/me";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CombinedMeCard", () => {
  it("requests the caller's own figure for the range and shows 'Your combined usage'", async () => {
    const { urls } = stubRoutes({ [PATH]: personShow() });
    renderWithProviders(<CombinedMeCard range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Your combined usage",
    });
    expect(region).toHaveTextContent("$15.00");
    expect(urls[0]?.searchParams.get("dateFrom")).toBe("2026-01-11");
    expect(urls[0]?.searchParams.get("dateTo")).toBe("2026-01-20");
  });

  it("hidden (a Viewer while the gateway is not configured): no card at all", async () => {
    stubRoutes({ [PATH]: HIDDEN });
    const view = renderWithProviders(<CombinedMeCard range={RANGE} />);
    await waitFor(() =>
      expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull(),
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("a 503 shows this card's error state only", async () => {
    stubRoutes({
      [PATH]: () =>
        apiResponse(
          { error: { code: "LITELLM_UNAVAILABLE", message: "unavailable" } },
          503,
        ),
    });
    renderWithProviders(<CombinedMeCard range={RANGE} />);
    expect(
      await screen.findByText("Couldn't load your combined usage."),
    ).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HIDDEN,
  ME_ADMIN,
  personShow,
  stubRoutes,
} from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { CombinedPersonCard } from "./CombinedPersonCard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": States (LD37 "LiteLLM not configured"; a Bedrock-only figure is
// never labelled combined; gateway not configured -> the warning text or
// hidden), Visibility, Computation -> Person (costEstimated always true,
// litellmUser false when LiteLLM has no such user), UI pieces. The one
// presentational card for a person's combined figure, shared by My usage
// (CombinedMeCard) and the selected user on Management -> Users
// (UserSearch). Rule 60.24a: states are tested here once.
// Module under test: `components/litellm/combined/CombinedPersonCard.tsx`
//   <CombinedPersonCard title response={CombinedMeResponse} />
// Renders a region named `title`, or nothing at all for a hidden response.
// The warn state mounts <CombinedWarning /> (needs QueryClient: it reads
// GET /api/me), so only the warn case renders with providers.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CombinedPersonCard", () => {
  it("show: the figure with its parts, estimate badge and a region named by the title", () => {
    render(
      <CombinedPersonCard
        title="Your combined usage"
        response={personShow()}
      />,
    );
    const region = screen.getByRole("region", { name: "Your combined usage" });
    expect(region).toHaveTextContent("$15.00");
    expect(
      screen.getByText("Direct Bedrock $10.00 · Via LiteLLM $5.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("Includes estimates")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hidden: renders nothing at all (no region, no text)", () => {
    const { container } = render(
      <CombinedPersonCard title="Your combined usage" response={HIDDEN} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("warn: the exact warning in a status element, with the figure still shown", () => {
    stubRoutes({ "/api/me": ME_ADMIN });
    renderWithProviders(
      <CombinedPersonCard
        title="Combined usage"
        response={personShow({
          visibility: "warn",
          gatewayConfigured: false,
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "gateway not configured — totals may double count",
    );
    expect(screen.getByTestId("combined-total")).toBeInTheDocument();
  });

  it("LD37 LiteLLM not configured: says so and shows no combined figure", () => {
    render(
      <CombinedPersonCard
        title="Your combined usage"
        response={personShow({
          configured: false,
          litellm: null,
          litellmUser: false,
          combined: null,
        })}
      />,
    );
    expect(screen.getByText("LiteLLM not configured")).toBeInTheDocument();
    expect(screen.queryByTestId("combined-total")).toBeNull();
    expect(screen.queryByText(/Via LiteLLM/)).toBeNull();
  });

  it("a person with no LiteLLM user: the LiteLLM part is $0.00 and says no LiteLLM user", () => {
    render(
      <CombinedPersonCard
        title="Your combined usage"
        response={personShow({ litellm: 0, litellmUser: false, combined: 10 })}
      />,
    );
    expect(
      screen.getByText("Direct Bedrock $10.00 · Via LiteLLM $0.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("No LiteLLM user")).toBeInTheDocument();
  });

  it("provisional: shows the provisional note", () => {
    render(
      <CombinedPersonCard
        title="Your combined usage"
        response={personShow({ provisional: true })}
      />,
    );
    expect(
      screen.getByText("Provisional: recent days are not final."),
    ).toBeInTheDocument();
  });
});

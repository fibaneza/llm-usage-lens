import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  departmentRowFixture,
  departmentsBody,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import DepartmentsPage from "./page";

// Source: Rule 60.7 (pages and layouts stay Server Components; the client
// boundary sits as deep as possible), Rule 60.12 (the client content reads the
// URL under Suspense); implementation-phases Phase 4.3 ("replace the
// placeholder").
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DepartmentsPage (/dashboard/departments)", () => {
  it("stays a Server Component shell", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("renders the department cards instead of the placeholder", async () => {
    stubApi({
      departments: () =>
        apiResponse(
          departmentsBody([
            departmentRowFixture({
              departmentId: "dept-eng",
              departmentName: "Engineering",
              cost: 600,
            }),
          ]),
        ),
    });
    renderWithProviders(await Promise.resolve(DepartmentsPage()), {
      searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" },
    });

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Engineering/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/dashboard/departments/dept-eng"),
    );
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});

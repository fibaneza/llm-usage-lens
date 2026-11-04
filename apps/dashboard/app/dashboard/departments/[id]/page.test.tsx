import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiResponse,
  departmentDetailBody,
  departmentDetailFixture,
  stubApi,
} from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import DepartmentDetailPage from "./page";

// Source: Rule 60.7 (page stays a Server Component), Rule 60.13 (`params` is
// a Promise and is awaited), Rule 60.12 (client content under Suspense);
// implementation-phases Phase 4.4 ("replace the placeholder").
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DepartmentDetailPage (/dashboard/departments/[id])", () => {
  it("stays a Server Component shell", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("awaits params and renders the detail for that id, not the placeholder", async () => {
    const stub = stubApi({
      departmentDetail: () =>
        apiResponse(
          departmentDetailBody(
            departmentDetailFixture({
              departmentId: "dept-data",
              departmentName: "Data Science",
            }),
          ),
        ),
    });
    renderWithProviders(
      await DepartmentDetailPage({
        params: Promise.resolve({ id: "dept-data" }),
      }),
      { searchParams: { dateFrom: "2026-01-11", dateTo: "2026-01-20" } },
    );

    expect(
      await screen.findByRole("heading", { name: "Data Science" }),
    ).toBeInTheDocument();
    expect(stub.departmentDetailRequests()[0]?.pathname).toBe(
      "/api/departments/dept-data",
    );
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});

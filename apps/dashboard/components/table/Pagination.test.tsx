import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "./Pagination";

// Design System -- Component Inventory, `Pagination`: "Page through table
// results (default 20 rows)". pageIndex is zero-based (TanStack Table); the
// visible text is one-based: "Page X of Y". onPageChange receives the new
// zero-based page index. Amended 2026-11-16 (Table spec): the page controls
// show only when there is more than one page, the row count always shows
// ("1-20 of 23 rows", en dash); `rowCount` and `pageSize` are required props.
function renderPagination(
  pageIndex: number,
  pageCount: number,
  rowCount = pageCount * 20,
) {
  const onPageChange = vi.fn<(pageIndex: number) => void>();
  render(
    <Pagination
      pageIndex={pageIndex}
      pageCount={pageCount}
      rowCount={rowCount}
      pageSize={20}
      onPageChange={onPageChange}
    />,
  );
  return onPageChange;
}

const previous = () => screen.getByRole("button", { name: /previous/i });
const next = () => screen.getByRole("button", { name: /next/i });

describe("Pagination", () => {
  it("is a navigation landmark labelled Pagination", () => {
    renderPagination(0, 3);

    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
  });

  it("shows a one-based 'Page X of Y'", () => {
    renderPagination(1, 5);

    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  });

  it("disables Previous on the first page and enables Next", () => {
    renderPagination(0, 3);

    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
  });

  it("disables Next on the last page and enables Previous", () => {
    renderPagination(2, 3);

    expect(next()).toBeDisabled();
    expect(previous()).toBeEnabled();
  });

  it("enables both buttons on a middle page", () => {
    renderPagination(1, 3);

    expect(previous()).toBeEnabled();
    expect(next()).toBeEnabled();
  });

  it("hides the page controls when there is a single page, keeping the row count", () => {
    renderPagination(0, 1, 3);

    expect(
      screen.queryByRole("button", { name: /previous/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /next/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Page 1 of 1/)).not.toBeInTheDocument();
    expect(screen.getByText(/3 rows/)).toBeInTheDocument();
  });

  it("hides the page controls when there are no pages", () => {
    renderPagination(0, 0, 0);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the visible row range and total beside the controls", () => {
    renderPagination(0, 2, 23);
    expect(screen.getByText("1\u201320 of 23 rows")).toBeInTheDocument();
  });

  it("clamps the range end to the row count on the last page", () => {
    renderPagination(1, 2, 23);
    expect(screen.getByText("21\u201323 of 23 rows")).toBeInTheDocument();
  });

  it("asks for the next page index when Next is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = renderPagination(1, 4);

    await user.click(next());

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("asks for the previous page index when Previous is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = renderPagination(2, 4);

    await user.click(previous());

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("does not fire onPageChange from a disabled button", async () => {
    const user = userEvent.setup();
    const onPageChange = renderPagination(0, 2);

    await user.click(previous());

    expect(onPageChange).not.toHaveBeenCalled();
  });
});

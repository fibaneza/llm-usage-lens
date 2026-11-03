import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportButton } from "./ExportButton";

// Design System -- Component Inventory, `ExportButton`: "Export table data to
// CSV". The button builds an RFC 4180 CSV, wraps it in a text/csv Blob and
// downloads it through an anchor with the `download` attribute. jsdom has no
// object URLs and cannot navigate, so URL.createObjectURL and the anchor click
// are stubbed -- no real download happens (Rule 60.24).
type Row = { name: string; cost: number };

const columns = [
  { header: "Name", value: (r: Row) => r.name },
  { header: "Cost (USD)", value: (r: Row) => r.cost },
];
const rows: Row[] = [
  { name: "Alpha", cost: 12.5 },
  { name: "Acme, Inc", cost: 3 },
];

type Downloaded = { download: string; href: string };

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
let downloads: Downloaded[];

beforeEach(() => {
  createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:csv-test");
  revokeObjectURL = vi.fn<(url: string) => void>();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function click(this: HTMLAnchorElement) {
      downloads.push({ download: this.download, href: this.href });
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("ExportButton", () => {
  it("renders a button labelled Export CSV", () => {
    render(
      <ExportButton filename="ranking.csv" columns={columns} rows={rows} />,
    );

    expect(
      screen.getByRole("button", { name: "Export CSV" }),
    ).toBeInTheDocument();
  });

  it("downloads the file under the given filename", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton
        filename="ranking-teams-2026-01-01-2026-01-30.csv"
        columns={columns}
        rows={rows}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toEqual({
      download: "ranking-teams-2026-01-01-2026-01-30.csv",
      href: "blob:csv-test",
    });
  });

  it("hands the anchor a text/csv Blob holding the header row and the rows", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton filename="ranking.csv" columns={columns} rows={rows} />,
    );

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!blob) throw new Error("no Blob was created");
    expect(blob.type).toMatch(/^text\/csv/);
    const text = (await readBlob(blob))
      .replace(/^\uFEFF/, "")
      .replace(/\r?\n$/, "");
    expect(text.split(/\r?\n/)).toEqual([
      "Name,Cost (USD)",
      "Alpha,12.5",
      '"Acme, Inc",3',
    ]);
  });

  it("exports the rows it is currently given", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ExportButton filename="ranking.csv" columns={columns} rows={rows} />,
    );
    rerender(
      <ExportButton
        filename="ranking.csv"
        columns={columns}
        rows={[{ name: "Only", cost: 1 }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error("no Blob was created");
    const text = await readBlob(blob);
    expect(text).toContain("Only,1");
    expect(text).not.toContain("Alpha");
  });

  it("releases the object URL and leaves no anchor behind", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton filename="ranking.csv" columns={columns} rows={rows} />,
    );

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv-test"),
    );
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("does not download until the button is clicked", () => {
    render(
      <ExportButton filename="ranking.csv" columns={columns} rows={rows} />,
    );

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(0);
  });
});

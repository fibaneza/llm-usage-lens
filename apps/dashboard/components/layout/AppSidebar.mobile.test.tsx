import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

// A minimal client router: <Link> clicks change the pathname and notify
// usePathname subscribers, the way an App Router navigation re-renders the
// persistent layout. It makes "close on route change" and "close on link
// click" implementations equally observable without asserting on internals.
const route = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { pathname: "/dashboard" };
  return {
    state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate(href: string) {
      state.pathname = href.split("?")[0] ?? href;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore: useStore } = await import("react");
  return {
    usePathname: () =>
      useStore(
        route.subscribe,
        () => route.state.pathname,
        () => route.state.pathname,
      ),
    useSearchParams: () => new URLSearchParams(),
  };
});

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      onClick,
      children,
      ...rest
    }: React.ComponentProps<"a"> & { href: string }) =>
      React.createElement(
        "a",
        {
          href,
          ...rest,
          // Like next/link: a handler that prevents the default cancels the
          // client navigation.
          onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
            onClick?.(event);
            if (!event.defaultPrevented) {
              event.preventDefault();
              route.navigate(href);
            }
          },
        },
        children,
      ),
  };
});

function PathnameProbe() {
  const pathname = useSyncExternalStore(
    route.subscribe,
    () => route.state.pathname,
    () => route.state.pathname,
  );
  return <output data-testid="pathname">{pathname}</output>;
}

function renderMobileShell() {
  return render(
    <SidebarProvider>
      <SidebarTrigger />
      <PathnameProbe />
      <AppSidebar />
    </SidebarProvider>,
  );
}

// useIsMobile reads window.innerWidth (md breakpoint is 768).
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("AppSidebar - mobile sheet (375px)", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    route.state.pathname = "/dashboard";
    setViewportWidth(375);
  });

  afterEach(() => {
    setViewportWidth(originalWidth);
  });

  it("renders the sidebar as a closed sheet until the trigger is pressed", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(
      await screen.findByRole("dialog", { name: "Sidebar" }),
    ).toBeInTheDocument();
  });

  // WAI-ARIA dialog pattern: Escape closes a modal and focus returns to the
  // control that opened it. The first focusable control inside the sheet must
  // not swallow the Escape (a single press closes).
  it("closes on a single Escape press", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sidebar" });

    await user.keyboard("{Escape}");

    expect(dialog).not.toBeInTheDocument();
  });

  it("returns focus to the sidebar trigger when Escape closes it", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Sidebar" });

    await user.keyboard("{Escape}");

    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("navigates and closes the sheet when a nav link is clicked", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sidebar" });

    await user.click(screen.getByRole("link", { name: "Ranking" }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/dashboard/ranking",
    );
    expect(dialog).not.toBeInTheDocument();
  });

  // The brand link and the footer Settings link live outside the nav groups;
  // each must close the sheet like the group links do.
  it.each([
    {
      label: "footer Settings link",
      name: "Settings",
      to: "/dashboard/settings",
    },
    {
      label: "brand link",
      name: "Bedrock Cost — go to overview",
      to: "/dashboard",
    },
  ])("navigates and closes the sheet from the $label", async ({ name, to }) => {
    const user = userEvent.setup();
    route.state.pathname = "/dashboard/ranking";
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sidebar" });

    await user.click(screen.getByRole("link", { name }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(to);
    expect(dialog).not.toBeInTheDocument();
  });

  it("reopens on the next trigger press after navigating from the sheet", async () => {
    const user = userEvent.setup();
    renderMobileShell();
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });

    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Sidebar" });
    await user.click(screen.getByRole("link", { name: "Teams" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(
      await screen.findByRole("dialog", { name: "Sidebar" }),
    ).toBeInTheDocument();
  });
});

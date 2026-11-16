import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
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

// The desktop rail state the provider keeps while the viewport is mobile.
function RailStateProbe() {
  const { state } = useSidebar();
  return <output data-testid="rail-state">{state}</output>;
}

function renderMobileShell({ defaultOpen = true } = {}) {
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      <SidebarTrigger />
      <PathnameProbe />
      <RailStateProbe />
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

  // The brand link lives outside the nav groups and Settings is the lone item
  // of the Administration group (Design System - Navigation (Sidebar)); each
  // must close the sheet like the other group links do.
  it.each([
    {
      label: "Administration Settings link",
      name: "Settings",
      to: "/dashboard/settings",
    },
    {
      label: "brand link",
      name: "LLM Usage Lens — go to overview",
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
    await user.click(screen.getByRole("link", { name: "Cost by team" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(
      await screen.findByRole("dialog", { name: "Sidebar" }),
    ).toBeInTheDocument();
  });
});

describe("AppSidebar - mobile sheet footer (375px)", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    route.state.pathname = "/dashboard";
    setViewportWidth(375);
  });

  afterEach(() => {
    setViewportWidth(originalWidth);
  });

  // Design System - Navigation (Sidebar): Settings sits in Administration and
  // the footer holds only the collapse button, in the sheet too (slice B1).
  it("holds only the collapse button in the sheet footer, with Settings in Administration", async () => {
    const user = userEvent.setup();
    renderMobileShell();

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sidebar" });
    const footer = dialog.querySelector('[data-slot="sidebar-footer"]');
    if (!(footer instanceof HTMLElement)) throw new Error("no footer");

    expect(within(footer).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(footer)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Collapse"]);
    const labels = [
      ...dialog.querySelectorAll('[data-slot="sidebar-group-label"]'),
    ].map((el) => el.textContent);
    expect(labels).toEqual(["Usage", "Management", "Administration"]);
  });
});

// WCAG 4.1.2 Name, Role, Value (Rule 60.30): in the sheet the content is always
// shown expanded and the footer toggle closes it, so its name is "Collapse"
// whatever the desktop rail's state. `defaultOpen={false}` is a user who
// collapsed the rail at desktop width and then narrowed the window: the desktop
// state stays "collapsed" (useSidebar().state) while isMobile is true. The name
// must follow the mobile context, not that stale desktop state. (The resize
// itself needs a real matchMedia, so it is exercised in e2e/responsive.spec.ts.)
describe("AppSidebar - mobile sheet rail toggle name (375px)", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    route.state.pathname = "/dashboard";
    setViewportWidth(375);
  });

  afterEach(() => {
    setViewportWidth(originalWidth);
  });

  it.each([
    { desktopRail: "expanded", defaultOpen: true },
    { desktopRail: "collapsed", defaultOpen: false },
  ])(
    "is named Collapse in the sheet when the desktop rail is $desktopRail",
    async ({ desktopRail, defaultOpen }) => {
      const user = userEvent.setup();
      renderMobileShell({ defaultOpen });
      // Premise: the stale desktop state is what the toggle must ignore here.
      expect(screen.getByTestId("rail-state")).toHaveTextContent(desktopRail);

      await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
      const dialog = await screen.findByRole("dialog", { name: "Sidebar" });

      expect(
        within(dialog).getByRole("button", { name: "Collapse" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Expand" }),
      ).not.toBeInTheDocument();
    },
  );

  it("closes the sheet when pressed, as its name says, even if the desktop rail is collapsed", async () => {
    const user = userEvent.setup();
    renderMobileShell({ defaultOpen: false });

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sidebar" });

    await user.click(within(dialog).getByRole("button", { name: "Collapse" }));

    expect(dialog).not.toBeInTheDocument();
  });
});

"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { withDateRange } from "@/lib/date-range-search-params";
import { navGroupsFor, type NavScope } from "@/lib/nav";

const NON_GLOBAL_SCOPE: NavScope = {
  global: false,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
};

// Cmd+K quick-jump menu. The trigger is styled as a search box; the dialog is
// also toggled by a global ⌘K / Ctrl+K listener. v1 is a skeleton search over
// the nav destinations only — real department/team/user/service entries are
// populated in Phase 5 (design-system — CommandMenu; implementation-phases
// Phase 2.2). Pure client UI: no AWS/data imports (Rule 10).
export function CommandMenu({ scope }: { scope?: NavScope }) {
  const router = useRouter();
  // Quick-jumps carry the active global date range too, matching the sidebar
  // links so the filter survives navigation (issue #75).
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // No scope fails closed to the non-global destinations.
  const groups = navGroupsFor(scope ?? NON_GLOBAL_SCOPE);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function navigate(href: string) {
    setOpen(false);
    router.push(withDateRange(href, searchParams));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        title="Search (⌘K)"
        className="text-muted-foreground border-border bg-background hover:bg-accent focus:ring-ring inline-flex h-9 w-full max-w-56 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus:ring-2 focus:outline-hidden md:max-[1440px]:w-9 md:max-[1440px]:justify-center md:max-[1440px]:px-0"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 text-left md:max-[1440px]:hidden">Search…</span>
        <Kbd className="md:max-[1440px]:hidden">⌘K</Kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={item.title}
                    onSelect={() => navigate(item.href)}
                  >
                    <Icon />
                    <span>{item.title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

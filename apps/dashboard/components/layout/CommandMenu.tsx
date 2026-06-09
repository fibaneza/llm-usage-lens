"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { NAV_ITEMS } from "@/lib/nav";

// Cmd+K quick-jump menu. The trigger is styled as a search box; the dialog is
// also toggled by a global ⌘K / Ctrl+K listener. v1 is a skeleton search over
// the nav destinations only — real department/team/user/service entries are
// populated in Phase 5 (design-system — CommandMenu; implementation-phases
// Phase 2.2). Pure client UI: no AWS/data imports (Rule 10).
export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground border-border bg-background hover:bg-accent focus:ring-ring inline-flex h-9 w-full max-w-56 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus:ring-2 focus:outline-hidden"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Pages">
            {NAV_ITEMS.map((item) => {
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
        </CommandList>
      </CommandDialog>
    </>
  );
}

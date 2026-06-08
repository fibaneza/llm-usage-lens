"use client";

import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type UserMenuUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

function initials(user: UserMenuUser | null): string {
  const source = user?.name?.trim() || user?.email?.trim() || "";
  if (!source) {
    return "?";
  }
  const [first, second] = source.split(/\s+/).filter(Boolean);
  if (first && second) {
    return `${first[0]}${second[0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

type UserMenuProps = {
  user: UserMenuUser | null;
  // Server action wired from the server component (auth() lives server-side).
  signOutAction: () => Promise<void>;
};

export function UserMenu({ user, signOutAction }: UserMenuProps) {
  const name = user?.name ?? "Signed in";
  const email = user?.email ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-9 rounded-full p-0"
          aria-label="Open user menu"
        >
          <Avatar className="size-9">
            {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials(user)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{name}</span>
          {email ? (
            <span className="text-muted-foreground truncate text-xs font-normal">
              {email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

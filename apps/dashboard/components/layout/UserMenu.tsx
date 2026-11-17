"use client";

import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";

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
import {
  AUTH_METHOD_LABELS,
  GLOBAL_ROLES,
  ROLE_LABELS,
} from "@/lib/auth/roles";

export type UserMenuUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  roles?: readonly string[];
  authMethod?: string;
};

// Design System — User menu: labelled roles in GLOBAL_ROLES order; a role
// without a label is not shown.
function roleLabels(roles: readonly string[] | undefined): string {
  return GLOBAL_ROLES.filter((role) => roles?.includes(role))
    .map((role) => ROLE_LABELS[role])
    .join(", ");
}

function authMethodLabel(method: string | undefined): string | null {
  return (
    Object.entries(AUTH_METHOD_LABELS).find(([key]) => key === method)?.[1] ??
    null
  );
}

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
  const roles = roleLabels(user?.roles);
  const method = authMethodLabel(user?.authMethod);

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
            {/* Filled brand circle with white initials (design reference —
                the indigo avatar, not the default neutral fallback). */}
            <AvatarFallback className="bg-primary text-primary-foreground font-medium">
              {initials(user)}
            </AvatarFallback>
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
          {roles ? (
            <span className="text-muted-foreground text-xs font-normal">
              {roles}
            </span>
          ) : null}
          {method ? (
            <span className="text-muted-foreground text-xs font-normal">
              {method}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/account">
            <UserRound />
            Account
          </Link>
        </DropdownMenuItem>
        <form action={signOutAction}>
          {/* Radix closes the menu on select and unmounts this form before the
              browser submits it ("form is not connected"); keep it mounted
              until the action's redirect navigates away. */}
          <DropdownMenuItem
            asChild
            onSelect={(event) => event.preventDefault()}
          >
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

function initialsOf(userId: string): string {
  return userId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

// Design System -- Component Inventory, `UserAvatar`: neutral 20px initials
// avatar (per-user colour carried no information; amended 2026-11-16).
// Decorative: the adjacent name carries the identity.
export function UserAvatar({ userId }: { userId: string }) {
  return (
    <span
      aria-hidden="true"
      className="bg-muted text-foreground inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold"
    >
      {initialsOf(userId)}
    </span>
  );
}

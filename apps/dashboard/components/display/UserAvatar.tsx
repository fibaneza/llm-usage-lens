const AVATAR_COUNT = 8;

function initialsOf(userId: string): string {
  return userId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function avatarIndex(userId: string): number {
  let hash = 0;
  for (const char of userId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return (hash % AVATAR_COUNT) + 1;
}

// Design System -- Component Inventory, `UserAvatar`: initials on a color that
// is a pure function of the user ID. Decorative: the adjacent name carries
// the identity.
export function UserAvatar({ userId }: { userId: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `var(--color-avatar-${avatarIndex(userId)})` }}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
    >
      {initialsOf(userId)}
    </span>
  );
}

import type { AccountMeta } from "@llm-usage-lens/shared";

// D-ST5 (data-model spec - API Routes, POST /api/accounts): the server slugs
// the name and makes it unique; an identical existing name reuses its id.
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";

const norm = (name: string): string => name.trim().toLowerCase();

function uniqueId(prefix: string, name: string, taken: Set<string>): string {
  const base = `${prefix}-${slug(name)}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

// A team id is reused only for the same team name in the same department
// (ids are unique per department); a department id by its normalised name.
export function generateAccountIds(
  names: { departmentName: string; teamName: string },
  accounts: readonly AccountMeta[],
): { departmentId: string; teamId: string } {
  const departmentKey = norm(names.departmentName);
  const sameDepartment = accounts.filter(
    (a) => norm(a.departmentName) === departmentKey,
  );
  const departmentId =
    sameDepartment[0]?.departmentId ??
    uniqueId(
      "dept",
      names.departmentName,
      new Set(accounts.map((a) => a.departmentId)),
    );
  const teamKey = norm(names.teamName);
  const teamId =
    sameDepartment.find((a) => norm(a.teamName) === teamKey)?.teamId ??
    uniqueId("team", names.teamName, new Set(accounts.map((a) => a.teamId)));
  return { departmentId, teamId };
}

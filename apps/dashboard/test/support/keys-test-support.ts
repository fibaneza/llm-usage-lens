// Playwright-loadable key builders for e2e seeds; exempt like keys.ts because it is pure with no I/O (coordinator ruling, 2026-11-16, 4R.5).
export {
  AFFILIATION_SK,
  META_SK,
  adminScopeSk,
  adminsGsi1pk,
  identPk,
  membersGsi1pk,
} from "../../lib/data/access/keys";

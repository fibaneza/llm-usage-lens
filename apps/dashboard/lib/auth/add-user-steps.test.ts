import { describe, expect, it } from "vitest";

import { addUserStepsFor } from "./add-user-steps";

// Source: Design System - Management improvements, Users (D15): "A step is
// shown only to a caller who may do it, so an org-admin sees steps 2 and 3,
// and under Entra step 1 is absent"; implementation-phases M3 Verify ("Add
// user shows only the steps the caller may do"); Access Control - LiteLLM user
// links (link: admin and org-admin; the auditor and a lead read only).
describe("addUserStepsFor", () => {
  it.each([
    [
      "an admin before SSO: password, team and link",
      ["internal-admin"],
      false,
      { password: true, team: true, link: true },
    ],
    [
      "an org-admin: team and link, no password step",
      ["internal-org-admin"],
      false,
      { password: false, team: true, link: true },
    ],
    [
      "an admin under Entra: no password step (a person is never created in the app)",
      ["internal-admin"],
      true,
      { password: false, team: true, link: true },
    ],
    [
      "an org-admin under Entra: team and link",
      ["internal-org-admin"],
      true,
      { password: false, team: true, link: true },
    ],
    [
      "an auditor: nothing",
      ["internal-auditor"],
      false,
      { password: false, team: false, link: false },
    ],
    [
      "a viewer (a lead has no global role): nothing",
      ["internal-viewer"],
      false,
      { password: false, team: false, link: false },
    ],
    [
      "no roles: nothing",
      [],
      false,
      { password: false, team: false, link: false },
    ],
  ])("%s", (_label, roles, entra, expected) => {
    expect(addUserStepsFor({ roles, entra })).toEqual(expected);
  });
});

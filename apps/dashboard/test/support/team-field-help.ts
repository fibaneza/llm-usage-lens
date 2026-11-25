import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

// Design System - Team page, round 3 (unit TP1), the FieldHelp text table:
// the exact text of each field, T-TP6. One copy for every component test.
export const TEAM_FIELD_HELP = {
  Members: "The people in this team. A person is in one team at most.",
  "Work email or UPN (add member)":
    "The address the person signs in with. If they have not signed in yet, they get an invitation that binds when they do.",
  "Team admins":
    "People who lead this team: they manage its members and what it shows.",
  "Team totals":
    "Whether members see this team's total cost and its breakdowns.",
  "User level":
    "Which per-person rows members see: everyone's (All), only their own (Own), or none.",
  "Department totals":
    "Whether members of this department's teams see the department's total. It reveals the other teams' combined spend.",
  "User level cap":
    "The most any team in this department may show per person. A team set higher is limited to this.",
  "Pending invitations": "People invited by email who have not signed in yet.",
  "Stale access":
    "Access held by someone who has not signed in for a long time. Review it and remove what is not needed.",
  "Max budget":
    "The most this LiteLLM team may spend in one budget period. LiteLLM refuses requests above it.",
  "Budget period": "How often LiteLLM sets the spend counter back to zero.",
  "Tokens per minute":
    "The most tokens, or requests, per minute LiteLLM accepts for this team.",
  "Requests per minute":
    "The most tokens, or requests, per minute LiteLLM accepts for this team.",
  Models: "The models this LiteLLM team may call.",
} as const;

export type TeamHelpField = keyof typeof TEAM_FIELD_HELP;

// T-TP6: the button "About <field>" exists and a click opens its text.
export async function expectFieldHelp(field: TeamHelpField) {
  const button = await screen.findByRole("button", { name: `About ${field}` });
  await userEvent.setup({ pointerEventsCheck: 0 }).click(button);
  expect(await screen.findByText(TEAM_FIELD_HELP[field])).toBeVisible();
}

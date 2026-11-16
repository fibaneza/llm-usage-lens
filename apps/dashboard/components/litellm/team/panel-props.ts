// What every team panel needs to mount anywhere (the interim team
// configuration page, the Team management page): the team and the viewer's
// rights. `canRaiseLimits` is true for Admin and org-admin; a Lead only lowers
// (LiteLLM spec -- Budgets and limits). The operations enabled for the team
// come from the team detail read each panel shares, not from the page.
export type TeamPanelProps = {
  teamId: string;
  capabilities: { canRaiseLimits: boolean };
};

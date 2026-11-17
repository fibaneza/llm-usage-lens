import { TeamLinkSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { AppTeamsSchema } from "@/components/settings/litellm-panel/SpendSourceTable";

export const TEAM_LINKS_KEY = ["litellm", "team-links"] as const;
export const TeamLinksSchema = z.object({
  items: z.array(TeamLinkSchema),
  appTeams: AppTeamsSchema.optional(),
});

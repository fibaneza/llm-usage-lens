import { TeamLinkSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { AppTeamsSchema } from "@/components/settings/litellm-panel/SpendSourceTable";

export const TEAM_LINKS_KEY = ["litellm", "team-links"] as const;
export const TeamLinksSchema = z.object({
  items: z.array(TeamLinkSchema),
  appTeams: AppTeamsSchema.optional(),
  // M1 (MI-D4a): the LiteLLM team list for the pickers. `configured: false`
  // omits it (LD37); `litellmTeamsUnavailable` marks a failed or disabled read.
  configured: z.boolean().optional(),
  litellmTeams: z
    .array(z.object({ litellmTeamId: z.string(), alias: z.string() }))
    .optional(),
  litellmTeamsUnavailable: z.boolean().optional(),
});

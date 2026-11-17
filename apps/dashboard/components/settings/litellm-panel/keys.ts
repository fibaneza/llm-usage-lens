import { TeamLinkSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

export const TEAM_LINKS_KEY = ["litellm", "team-links"] as const;
export const TeamLinksSchema = z.object({ items: z.array(TeamLinkSchema) });

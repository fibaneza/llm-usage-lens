import { SpendSourceSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const AppTeamsSchema = z.array(
  z.object({
    teamId: z.string(),
    teamName: z.string(),
    spendSource: SpendSourceSchema,
  }),
);

const SOURCE_LABEL = {
  "litellm-team": "LiteLLM team",
  "member-sum": "Sum of members",
} as const;

// Source: docs/specs/2026-11-17-app-teams.md -- UI (Settings -> LiteLLM ->
// Team links: a "Spend source" column for every app team). Absent `appTeams`
// renders nothing.
export function SpendSourceTable({
  appTeams,
}: {
  appTeams: z.infer<typeof AppTeamsSchema> | undefined;
}) {
  if (!appTeams || appTeams.length === 0) return null;
  return (
    <Table>
      <TableCaption className="mt-0 mb-2 text-left">
        Spend source by app team
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>App team</TableHead>
          <TableHead>Spend source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {appTeams.map((team) => (
          <TableRow key={team.teamId}>
            <TableCell>{team.teamName}</TableCell>
            <TableCell>{SOURCE_LABEL[team.spendSource]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

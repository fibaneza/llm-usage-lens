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

// Source: docs/specs/2026-11-17-app-teams.md -- UI (LiteLLM teams tab, LF1
// D-LF3): only app teams linked to a LiteLLM team are listed; absent
// `appTeams` or no linked team renders nothing.
export function SpendSourceTable({
  appTeams,
}: {
  appTeams: z.infer<typeof AppTeamsSchema> | undefined;
}) {
  const linked = (appTeams ?? []).filter(
    (team) => team.spendSource === "litellm-team",
  );
  if (linked.length === 0) return null;
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
        {linked.map((team) => (
          <TableRow key={team.teamId}>
            <TableCell>{team.teamName}</TableCell>
            <TableCell>{SOURCE_LABEL[team.spendSource]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

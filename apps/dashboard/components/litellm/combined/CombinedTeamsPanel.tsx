"use client";

import {
  CombinedTeamsResponseSchema,
  type CombinedTeamFigure,
} from "@llm-usage-lens/shared";

import { formatUsd } from "@/components/charts/chart-data";
import { Panel } from "@/components/display/Panel";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";

import { CombinedBoundary } from "./CombinedBoundary";
import { CombinedWarning } from "./CombinedWarning";
import {
  combinedPath,
  useCombinedQuery,
  type CombinedRange,
} from "./use-combined-query";

const NUMERIC = "text-right font-mono tabular-nums";
const TITLE = "Combined with LiteLLM";

const viaLiteLLM = (team: CombinedTeamFigure) =>
  team.litellm === null ? "—" : formatUsd(team.litellm);
const combinedText = (team: CombinedTeamFigure) =>
  team.combined === null ? "not linked" : formatUsd(team.combined);

function TeamName({ team }: { team: CombinedTeamFigure }) {
  return (
    <>
      <span className="font-medium">{team.teamName}</span>
      {team.gatewaySlice > 0 ? (
        <span className="text-muted-foreground block text-xs">
          {`Billed via LiteLLM ${formatUsd(team.gatewaySlice)}`}
        </span>
      ) : null}
    </>
  );
}

function TeamsTable({ teams }: { teams: readonly CombinedTeamFigure[] }) {
  return (
    <Table>
      <TableCaption className="sr-only">{TITLE}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">Direct Bedrock</TableHead>
          <TableHead className="text-right">Via LiteLLM</TableHead>
          <TableHead className="text-right">Combined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {teams.map((team) => (
          <TableRow key={team.teamId}>
            <TableCell>
              <TeamName team={team} />
            </TableCell>
            <TableCell className={NUMERIC}>
              {formatUsd(team.bedrockDirect)}
            </TableCell>
            <TableCell className={NUMERIC}>{viaLiteLLM(team)}</TableCell>
            <TableCell className={NUMERIC}>{combinedText(team)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Design System -- Responsive Tables: a card list below md.
function TeamsCards({ teams }: { teams: readonly CombinedTeamFigure[] }) {
  return (
    <ul role="list" aria-label={TITLE} className="space-y-3 px-4 pb-1">
      {teams.map((team) => (
        <li
          key={team.teamId}
          className="bg-card rounded-card space-y-2 border p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 break-words">
              <TeamName team={team} />
            </div>
            <div className="shrink-0 font-mono font-semibold tabular-nums">
              <span className="sr-only">Combined</span>
              {combinedText(team)}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Direct Bedrock</dt>
              <dd className="font-mono tabular-nums">
                {formatUsd(team.bedrockDirect)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">Via LiteLLM</dt>
              <dd className="font-mono tabular-nums">{viaLiteLLM(team)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function TeamsContent({ range }: { range: CombinedRange }) {
  const isMobile = useIsMobile();
  const response = useCombinedQuery(
    combinedPath("teams", range),
    CombinedTeamsResponseSchema,
  );
  if (!response || response.visibility === "hidden") return null;
  return (
    <Panel title={TITLE} boundaryTitle="combined with litellm" flush>
      <div className="flex flex-col gap-3">
        {response.visibility === "warn" ? (
          <div className="px-4">
            <CombinedWarning />
          </div>
        ) : null}
        {!response.configured ? (
          <p className="text-muted-foreground px-4 text-sm">
            LiteLLM not configured
          </p>
        ) : response.teams.length === 0 ? (
          <p className="text-muted-foreground px-4 text-sm">No teams</p>
        ) : isMobile ? (
          <TeamsCards teams={response.teams} />
        ) : (
          <TeamsTable teams={response.teams} />
        )}
      </div>
    </Panel>
  );
}

// LiteLLM spec -- Combined usage (L6), Where each figure appears: Teams. A
// separate panel; the Bedrock table stays Bedrock-only (provenance).
export function CombinedTeamsPanel({ range }: { range: CombinedRange }) {
  return (
    <CombinedBoundary
      title="combined with litellm"
      resetKeys={[range.dateFrom, range.dateTo]}
    >
      <TeamsContent range={range} />
    </CombinedBoundary>
  );
}

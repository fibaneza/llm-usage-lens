"use client";

import { LiteLLMModelsResponseSchema } from "@llm-usage-lens/shared";
import { useState } from "react";

import { FieldHelp } from "@/components/display/FieldHelp";
import { Button } from "@/components/ui/button";

import type { TeamPanelProps } from "./panel-props";
import { Empty, NotConnected, Unavailable } from "../LiteLLMSection";
import { WriteError } from "./write-parts";
import { useLiteLLMQuery } from "../use-litellm-query";
import { useTeamDetail } from "../use-team-detail";
import { teamPath, useTeamWrite } from "./use-team-write";

function ModelChoices({
  teamId,
  proxyModels,
  teamModels,
}: {
  teamId: string;
  proxyModels: readonly string[];
  teamModels: readonly string[];
}) {
  const { write, pending, error } = useTeamWrite(teamId);
  // Narrowing only (LD26): the team's own models, else everything /models lists.
  const choices = teamModels.length > 0 ? teamModels : proxyModels;
  const [checked, setChecked] = useState(() => new Set(teamModels));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void write(
          teamPath(teamId, "/models"),
          "PUT",
          { models: choices.filter((m) => checked.has(m)) },
          ["detail"],
        );
      }}
    >
      <WriteError message={error} />
      <div className="flex items-center gap-1 text-sm font-medium">
        <span>Models</span>
        <FieldHelp field="Models">
          The models this LiteLLM team may call.
        </FieldHelp>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Models this team can use</legend>
        {choices.map((model) => (
          <label key={model} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked.has(model)}
              onChange={(e) =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(model);
                  else next.delete(model);
                  return next;
                })
              }
            />
            {model}
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          Save models
        </Button>
      </div>
    </form>
  );
}

export function ModelsPanel({ teamId }: TeamPanelProps) {
  const detail = useTeamDetail(teamId);
  const proxy = useLiteLLMQuery(
    ["models"],
    "/api/litellm/models",
    LiteLLMModelsResponseSchema,
  );
  if (detail.status === "unavailable" || proxy.status === "unavailable") {
    return <Unavailable />;
  }
  if (detail.data.configured === false || !detail.data.connected)
    return <NotConnected />;
  if (!detail.data.enabledOperations.includes("setTeamModels")) {
    return <Empty>Changing team models is switched off.</Empty>;
  }
  const { models } = detail.data.team;
  return (
    <ModelChoices
      key={`${teamId}:${models.join(",")}`}
      teamId={teamId}
      proxyModels={proxy.data.items}
      teamModels={models}
    />
  );
}

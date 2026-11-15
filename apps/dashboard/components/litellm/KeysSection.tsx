"use client";

import { KeysTable } from "./KeysTable";
import { Empty, NotConnected, Unavailable } from "./LiteLLMSection";
import { LiteLLMKeysResponseSchema } from "@llm-usage-lens/shared";
import { useLiteLLMQuery } from "./use-litellm-query";

export function KeysSection({ teamId }: { teamId: string }) {
  const result = useLiteLLMQuery(
    ["team", teamId, "keys"],
    `/api/litellm/teams/${encodeURIComponent(teamId)}/keys`,
    LiteLLMKeysResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const { connected, items } = result.data;
  if (!connected) return <NotConnected />;
  if (items.length === 0) return <Empty>No keys for this team.</Empty>;
  return <KeysTable keys={items} caption="Team keys" />;
}

"use client";

import { IdentityDetailSchema } from "@llm-usage-lens/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Panel } from "@/components/display/Panel";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { ResetMemberSpendDialog } from "@/components/litellm/ResetMemberSpendDialog";
import { LiteLLMLinkCell } from "@/components/manage/users/LiteLLMLinkCell";
import { fetchApi } from "@/lib/query/fetch-api";

import { useProxyUser } from "./use-proxy-user";

type AppUser = {
  oid: string;
  name: string;
  email: string;
  appTeam: { teamId: string; name: string } | null;
};

// The Unlink write sends the link version read from the identity (Access
// Control - LiteLLM user links); read only for a caller who may write.
function UnlinkControl({
  person,
  litellmUserId,
}: {
  person: AppUser;
  litellmUserId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const identity = useQuery({
    queryKey: ["identity", person.oid],
    queryFn: () =>
      fetchApi(
        `/api/identities/${encodeURIComponent(person.oid)}`,
        IdentityDetailSchema,
      ),
    retry: false,
  });
  if (!identity.data) return null;
  return (
    <LiteLLMLinkCell
      subject={{
        oid: person.oid,
        name: person.name,
        email: person.email,
        version: identity.data.linkVersion,
      }}
      link={{ state: "linked", litellmUserId }}
      canWrite
      canCreate={false}
      showState={false}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: ["litellm"] });
        void queryClient.invalidateQueries({
          queryKey: ["identity", person.oid],
        });
        router.refresh();
      }}
    />
  );
}

// Design System - LiteLLM user page (unit LP2), T-LP8, T-LP9: the linked person
// (a link to their user page) or "Not linked to a dashboard user"; Reset spend
// and Unlink only for a caller who writes and never on their own person; links
// are not cost, so the Organisation cap does not hide them (LD23).
function LinkBody({
  litellmUserId,
  canWrite,
  ownOid,
}: {
  litellmUserId: string;
  canWrite: boolean;
  ownOid: string | null;
}) {
  const result = useProxyUser(litellmUserId);
  if (result.status !== "ok") return <Unavailable />;
  const { appUser, email, enabledOperations } = result.data;
  const person = appUser ?? null;
  const mayWrite = canWrite && (person === null || person.oid !== ownOid);
  const mayReset =
    mayWrite &&
    (enabledOperations.includes("resetUserSpend") ||
      enabledOperations.includes("resetMemberSpend"));
  return (
    <div className="flex flex-col gap-3 text-sm">
      {person ? (
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/dashboard/manage/users/${encodeURIComponent(person.oid)}`}
            className="focus-visible:ring-ring w-fit rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {person.name}
          </Link>
          <span className="text-muted-foreground">{person.email}</span>
          {person.appTeam ? (
            <span className="text-muted-foreground">{person.appTeam.name}</span>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground">Not linked to a dashboard user</p>
      )}
      {mayWrite || mayReset ? (
        <div className="flex flex-wrap items-center gap-2">
          {mayWrite && person ? (
            <UnlinkControl person={person} litellmUserId={litellmUserId} />
          ) : null}
          {mayReset ? (
            <ResetMemberSpendDialog
              {...(person ? { oid: person.oid } : {})}
              litellmUserId={litellmUserId}
              name={person?.name ?? email}
              userReset
              enabledOperations={enabledOperations}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProxyUserLinkPanel({
  litellmUserId,
  canWrite,
  ownOid,
}: {
  litellmUserId: string;
  canWrite: boolean;
  ownOid: string | null;
}) {
  return (
    <Panel title="Linked dashboard user" boundaryTitle="Linked dashboard user">
      <LinkBody
        litellmUserId={litellmUserId}
        canWrite={canWrite}
        ownOid={ownOid}
      />
    </Panel>
  );
}

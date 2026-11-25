"use client";

import type { IdentityDetail } from "@llm-usage-lens/shared";
import { useRouter } from "next/navigation";

import { Panel } from "@/components/display/Panel";
import { ResetMemberSpendDialog } from "@/components/litellm/ResetMemberSpendDialog";
import { LiteLLMLinkCell } from "@/components/manage/users/LiteLLMLinkCell";
import type { LinkState } from "@/components/manage/users/LiteLLMLinkCell";
import { Badge } from "@/components/ui/badge";

// Design System - "The user page (unit US2)" D-US7, D-US9: the LiteLLM link
// with Unlink or Link to an existing user, and RS1's Reset spend. Each uses its
// existing route; no LiteLLM user or member is created or removed here.
export function UserLinksPanel({
  detail,
  name,
  canOpenLiteLLM = false,
}: {
  detail: IdentityDetail;
  name: string;
  // T-LP10: the three LiteLLM-reading roles; anyone else gets the id as text.
  canOpenLiteLLM?: boolean;
}) {
  const router = useRouter();
  const { litellm, allowed } = detail;
  const linked = litellm.state === "linked";
  const canWrite = linked ? allowed.unlinkLiteLLM : allowed.linkLiteLLM;
  // UP1 (D-R3-13): the read sends a match only to a caller who may link.
  const link: LinkState = litellm;
  return (
    <Panel title="LiteLLM" boundaryTitle="the LiteLLM link">
      <div className="flex flex-wrap items-start gap-3">
        {linked || canWrite ? (
          <LiteLLMLinkCell
            subject={{
              oid: detail.oid,
              name,
              email: detail.email,
              version: detail.linkVersion,
            }}
            link={link}
            canWrite={canWrite}
            canCreate={false}
            {...(canOpenLiteLLM && litellm.state === "linked"
              ? {
                  userHref: `/dashboard/manage/litellm/users/${encodeURIComponent(litellm.litellmUserId)}`,
                }
              : {})}
            onChanged={() => router.refresh()}
          />
        ) : (
          <Badge variant="outline">Not linked</Badge>
        )}
        {litellm.state === "linked" && allowed.resetSpend ? (
          <ResetMemberSpendDialog
            oid={detail.oid}
            litellmUserId={litellm.litellmUserId}
            name={name}
          />
        ) : null}
      </div>
    </Panel>
  );
}

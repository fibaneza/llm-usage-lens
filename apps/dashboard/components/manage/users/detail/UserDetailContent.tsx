"use client";

import type { IdentityDetail } from "@llm-usage-lens/shared";

import { PageHeader } from "@/components/layout/PageHeader";
import { UserIdentitiesPanel } from "@/components/manage/users/detail/UserIdentitiesPanel";
import { UserLinksPanel } from "@/components/manage/users/detail/UserLinksPanel";
import { UserLiteLLMUsagePanel } from "@/components/manage/users/detail/UserLiteLLMUsagePanel";
import { UserProfilePanel } from "@/components/manage/users/detail/UserProfilePanel";
import { UserRolesPanel } from "@/components/manage/users/detail/UserRolesPanel";
import { UserSignInPanel } from "@/components/manage/users/detail/UserSignInPanel";
import { UserTeamPanel } from "@/components/manage/users/detail/UserTeamPanel";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";

// Design System - "The user page (unit US2)": D-US6 (what it shows), D-US7
// (every edit calls an existing route), D-US11 (a block the response leaves
// out is absent). The server decided every `allowed` flag; the routes decide
// again.
export function UserDetailContent({
  detail,
  canOpenPasswordUsers,
  canOpenLiteLLM = false,
  authMethod,
  stepUp,
}: {
  detail: IdentityDetail;
  canOpenPasswordUsers: boolean;
  canOpenLiteLLM?: boolean;
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
}) {
  const name = detail.displayName ?? detail.email ?? detail.oid;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[
          { label: "Users", href: "/dashboard/manage/users" },
          { label: name },
        ]}
        description="One person: how they sign in, their LiteLLM link, team and roles."
      />
      <UserProfilePanel detail={detail} name={name} />
      <UserSignInPanel
        detail={detail}
        canOpenPasswordUsers={canOpenPasswordUsers}
      />
      <UserLinksPanel
        detail={detail}
        name={name}
        canOpenLiteLLM={canOpenLiteLLM}
      />
      {detail.litellm.state === "linked" ? (
        <UserLiteLLMUsagePanel litellmUserId={detail.litellm.litellmUserId} />
      ) : null}
      <UserTeamPanel detail={detail} name={name} />
      {detail.roleGrants ? (
        <UserRolesPanel
          detail={detail}
          grants={detail.roleGrants}
          name={name}
          authMethod={authMethod}
          stepUp={stepUp}
        />
      ) : null}
      {detail.usageIdentities ? (
        <UserIdentitiesPanel
          detail={detail}
          usageIdentities={detail.usageIdentities}
        />
      ) : null}
    </div>
  );
}

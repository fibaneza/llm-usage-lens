"use client";

import { IdentityLinkSchema } from "@llm-usage-lens/shared";
import type { IdentityDetail } from "@llm-usage-lens/shared";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Panel } from "@/components/display/Panel";
import { UserKeyList } from "@/components/manage/users/detail/UserKeyList";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import { idPath } from "@/components/settings/access/access-queries";
import {
  FormError,
  FormStatus,
} from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import { mutateApi } from "@/lib/query/fetch-api";

// Design System - "The user page (unit US2)" D-US11: the admin edits usage
// identities and aliases with PUT /api/identities/[oid]/links (the link
// version the read carried; the LiteLLM user id is sent back unchanged);
// auditor and org-admin read.
export function UserIdentitiesPanel({
  detail,
  usageIdentities,
}: {
  detail: IdentityDetail;
  usageIdentities: readonly string[];
}) {
  const router = useRouter();
  const canEdit = detail.allowed.editUsageIdentities;
  const [lists, setLists] = useState({
    usageIdentities: [...usageIdentities],
    aliases: [...(detail.aliases ?? [])],
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/identities/${idPath(detail.oid)}/links`,
        "PUT",
        {
          usageIdentities: lists.usageIdentities,
          aliases: lists.aliases,
          ...(detail.litellm.state === "linked"
            ? { litellmUserId: detail.litellm.litellmUserId }
            : {}),
          version: detail.linkVersion,
        },
        IdentityLinkSchema,
      ),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });

  function add(list: "usageIdentities" | "aliases", raw: string) {
    const key = raw.trim().toLowerCase();
    if (key === "") return "Enter a key to add";
    if (lists.usageIdentities.includes(key) || lists.aliases.includes(key)) {
      return "That key is already listed";
    }
    setLists({ ...lists, [list]: [...lists[list], key] });
    setSaved(false);
    return null;
  }
  function remove(list: "usageIdentities" | "aliases", key: string) {
    setLists({ ...lists, [list]: lists[list].filter((k) => k !== key) });
    setSaved(false);
  }

  return (
    <Panel title="Usage identities" boundaryTitle="the usage identities">
      <div className="flex flex-col gap-4">
        <UserKeyList
          heading="Usage identities"
          kind="usage identity"
          keys={lists.usageIdentities}
          canEdit={canEdit}
          onAdd={(key) => add("usageIdentities", key)}
          onRemove={(key) => remove("usageIdentities", key)}
        />
        <UserKeyList
          heading="Aliases"
          kind="alias"
          keys={lists.aliases}
          canEdit={canEdit}
          onAdd={(key) => add("aliases", key)}
          onRemove={(key) => remove("aliases", key)}
        />
        {canEdit ? (
          <>
            <div>
              <Button
                type="button"
                size="sm"
                disabled={save.isPending}
                onClick={() => {
                  setSaved(false);
                  save.mutate();
                }}
              >
                Save links
              </Button>
            </div>
            {save.isError ? (
              <FormError>{accessErrorMessage(save.error)}</FormError>
            ) : null}
            {saved ? <FormStatus>Saved.</FormStatus> : null}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

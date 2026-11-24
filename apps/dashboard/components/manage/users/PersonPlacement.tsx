"use client";

import type { DirectoryRow, PersonInvite } from "@llm-usage-lens/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { TeamPickerDialog } from "@/components/manage/users/TeamPickerDialog";
import { useOrgUnits } from "@/components/settings/access/access-queries";
import { AcceptInviteDialog } from "@/components/settings/access/AcceptInviteDialog";
import { Button } from "@/components/ui/button";

// Source: Design System - Management -> Users, "Placing a person by hand"
// (INV2): the People table and the user page offer Add to team (signed in, no
// team) and Approve and add (an invite exists) from one set of components.
// `state` arrives only for callers who may write members (T-IV5); the routes
// decide every write again.
export function PersonPlacement({
  oid,
  name,
  state,
  invites,
  onDone,
}: {
  oid: string;
  name: string;
  state: DirectoryRow["state"];
  invites: ReadonlyArray<PersonInvite> | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const units = useOrgUnits();
  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  if (state === undefined) return null;
  const done = () => {
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["access"] });
    onDone();
  };
  if (state === "signed-in") {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Add ${name} to team`}
          onClick={() => setOpen(true)}
        >
          Add to team
        </Button>
        {open ? (
          <TeamPickerDialog
            action={{ kind: "add", oid }}
            personName={name}
            onClose={() => setOpen(false)}
            onDone={done}
          />
        ) : null}
      </>
    );
  }
  if (!invites || invites.length === 0) return null;
  const teamName = (id: string) =>
    units.data?.teams.find((t) => t.id === id)?.name ?? id;
  const target = invites.find((i) => `${i.teamId}\u0000${i.key}` === approving);
  return (
    <>
      {invites.map((invite) => (
        <Button
          key={`${invite.teamId}\u0000${invite.key}`}
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Approve and add ${name} (${teamName(invite.teamId)})`}
          onClick={() => setApproving(`${invite.teamId}\u0000${invite.key}`)}
        >
          Approve and add
        </Button>
      ))}
      {target ? (
        <AcceptInviteDialog
          teamId={target.teamId}
          teamName={teamName(target.teamId)}
          inviteKey={target.key}
          canSearch={false}
          onClose={() => setApproving(null)}
          onAccepted={() => {
            setApproving(null);
            done();
          }}
        />
      ) : null}
    </>
  );
}

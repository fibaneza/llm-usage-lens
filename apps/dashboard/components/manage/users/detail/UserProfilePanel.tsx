"use client";

import type { IdentityDetail } from "@llm-usage-lens/shared";
import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { Panel } from "@/components/display/Panel";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import { idPath } from "@/components/settings/access/access-queries";
import {
  FormError,
  FormField,
} from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateApi } from "@/lib/query/fetch-api";

// Design System - "The user page (unit US2)" D-US8: an SSO person's name and
// email come from Entra and are read-only; a password user's name is edited
// with PATCH /api/password-users/[email] ({ displayName } only); the email is
// their sign-in key and is never editable.
const RenamedSchema = z.object({ displayName: z.string().min(1) });
const MAX_NAME = 200;

const date = (iso: string | null, missing: string) =>
  iso ? iso.slice(0, 10) : missing;

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}

function NameEditor({
  email,
  version,
  current,
  onSaved,
  onClose,
}: {
  email: string;
  version: number | undefined;
  current: string;
  onSaved: (name: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [problem, setProblem] = useState<string | undefined>();
  const rename = useMutation({
    mutationFn: (displayName: string) =>
      mutateApi(
        `/api/password-users/${idPath(email)}`,
        "PATCH",
        { displayName, version },
        RenamedSchema,
      ),
    onSuccess: (saved) => {
      onSaved(saved.displayName);
      onClose();
      router.refresh();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = value.trim();
    if (text === "" || text.length > MAX_NAME) {
      setProblem(`Enter a name of 1 to ${MAX_NAME} characters`);
      return;
    }
    setProblem(undefined);
    rename.mutate(text);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <FormField label="Display name" error={problem}>
        {(props) => (
          <Input
            {...props}
            maxLength={MAX_NAME}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </FormField>
      {rename.isError ? (
        <FormError>{accessErrorMessage(rename.error)}</FormError>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={rename.isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function UserProfilePanel({
  detail,
  name,
}: {
  detail: IdentityDetail;
  name: string;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const shown = saved ?? name;
  const version = detail.passwordUserVersion;
  const canRename =
    detail.authMethod === "password" &&
    detail.allowed.editDisplayName &&
    detail.email !== null;

  return (
    <Panel
      title="Profile"
      boundaryTitle="the profile"
      actions={
        canRename && !editing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Edit name of ${shown}`}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {editing && detail.email ? (
          <NameEditor
            email={detail.email}
            version={version}
            current={shown}
            onSaved={setSaved}
            onClose={() => setEditing(false)}
          />
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Name">{shown}</Row>
          </dl>
        )}
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Email">{detail.email ?? "-"}</Row>
          <Row label="UPN">{detail.upn ?? "-"}</Row>
          <Row label="Created">{date(detail.createdAt, "unknown")}</Row>
          <Row label="Last sign-in">
            {date(detail.lastSignInAt, "Never signed in")}
          </Row>
        </dl>
        {detail.authMethod === "entra" ? (
          <p className="text-muted-foreground text-xs">
            Read-only: this information comes from Entra at every sign-in.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

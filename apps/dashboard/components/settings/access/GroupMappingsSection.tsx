"use client";

import {
  GroupMappingInputSchema,
  GroupMappingSchema,
} from "@llm-usage-lens/shared";
import type { GroupMapping } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  fetchAllPages,
  idPath,
  useOrgUnits,
} from "@/components/settings/access/access-queries";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import { ConfirmDialog } from "@/components/settings/access/ConfirmDialog";
import {
  FormError,
  FormField,
  NativeSelect,
  restoreFocusTo,
} from "@/components/settings/access/form-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Group mapping" (internal-
// admin only; a mapping grants a scoped role, never a global one; `member`
// targets must be teams - threat T4), "API routes (additions)", "Enforcement"
// item 6 (version -> 409; a body groupId equals the path groupId).
const GROUP_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ROLE_LABELS = {
  "internal-team-admin": "Team admin",
  member: "Member",
} as const;
type ScopedRole = keyof typeof ROLE_LABELS;
type TargetType = "team" | "department";

type Draft = {
  groupId: string;
  targetType: TargetType;
  targetId: string | null;
  scopedRole: ScopedRole;
};
type FieldErrors = Partial<Record<"groupId" | "target" | "scopedRole", string>>;
type Target = { type: TargetType; id: string; name: string };

function MappingDialog({
  existing,
  targets,
  pending,
  serverError,
  onSave,
  onClose,
  returnFocusTo,
}: {
  returnFocusTo: RefObject<HTMLElement | null>;
  existing: GroupMapping | null;
  targets: Target[];
  pending: boolean;
  serverError: string | null;
  onSave: (input: Omit<GroupMapping, "version" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    groupId: existing?.groupId ?? "",
    targetType: existing?.target.type ?? "team",
    targetId: existing?.target.id ?? null,
    scopedRole: existing?.scopedRole ?? "internal-team-admin",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const options = targets.filter((t) => t.type === draft.targetType);
  const targetId = draft.targetId ?? options[0]?.id ?? "";

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: FieldErrors = {};
    if (draft.groupId.trim() === "") found.groupId = "Group ID is required";
    else if (!GROUP_ID_PATTERN.test(draft.groupId.trim())) {
      found.groupId =
        "Use 1 to 128 letters, digits and . _ : - characters only";
    }
    if (targetId === "") found.target = "Choose a target";
    const input = {
      groupId: draft.groupId.trim(),
      target: { type: draft.targetType, id: targetId },
      scopedRole: draft.scopedRole,
    };
    const parsed = GroupMappingInputSchema.safeParse(input);
    if (!parsed.success && found.groupId === undefined) {
      const refused = parsed.error.issues.find(
        (i) => i.path[0] === "scopedRole",
      );
      if (refused) found.scopedRole = "Member applies to a team only";
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onSave(input);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onCloseAutoFocus={restoreFocusTo(returnFocusTo)}>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit mapping" : "Add mapping"}</DialogTitle>
          <DialogDescription>
            Members of the Entra group get this role on the target. A mapping
            never grants a global role.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label="Group ID" error={errors.groupId}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                readOnly={existing !== null}
                value={draft.groupId}
                onChange={(e) =>
                  setDraft({ ...draft, groupId: e.target.value })
                }
              />
            )}
          </FormField>
          <FormField label="Target type">
            {(props) => (
              <NativeSelect
                {...props}
                value={draft.targetType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    targetType: e.target.value as TargetType,
                    targetId: null,
                  })
                }
              >
                <option value="team">Team</option>
                <option value="department">Department</option>
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Target" error={errors.target}>
            {(props) => (
              <NativeSelect
                {...props}
                value={targetId}
                onChange={(e) =>
                  setDraft({ ...draft, targetId: e.target.value })
                }
              >
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Role" error={errors.scopedRole}>
            {(props) => (
              <NativeSelect
                {...props}
                value={draft.scopedRole}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    scopedRole: e.target.value as ScopedRole,
                  })
                }
              >
                {(Object.keys(ROLE_LABELS) as ScopedRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {serverError ? <FormError>{serverError}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {existing ? "Save mapping" : "Create mapping"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; mapping: GroupMapping }
  | { kind: "delete"; mapping: GroupMapping }
  | null;

export function GroupMappingsSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const mappings = sectionData(
    useQuery({
      queryKey: ["access", "group-mappings"],
      queryFn: () => fetchAllPages("/api/group-mappings", GroupMappingSchema),
    }),
  );
  // Names are context: an unreadable org list falls back to the target id.
  const orgUnits = useOrgUnits();
  const addButton = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["access", "group-mappings"] });
  const save = useMutation({
    mutationFn: (input: {
      groupId: string;
      target: { type: TargetType; id: string };
      scopedRole: ScopedRole;
      version?: number;
    }) =>
      input.version === undefined
        ? mutateApi("/api/group-mappings", "POST", input, IgnoredSchema)
        : mutateApi(
            `/api/group-mappings/${idPath(input.groupId)}`,
            "PATCH",
            input,
            IgnoredSchema,
          ),
    onSuccess: () => {
      setDialog(null);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (mapping: GroupMapping) =>
      mutateApi(
        `/api/group-mappings/${idPath(mapping.groupId)}`,
        "DELETE",
        { version: mapping.version },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setDialog(null);
      void refresh();
    },
    onError: () => void refresh(),
  });

  if (mappings === undefined) return <Skeleton className="h-40 w-full" />;

  const targets: Target[] = [
    ...(orgUnits.data?.teams ?? []).map((t) => ({
      type: "team" as const,
      id: t.id,
      name: t.name,
    })),
    ...(orgUnits.data?.departments ?? []).map((d) => ({
      type: "department" as const,
      id: d.id,
      name: d.name,
    })),
  ];
  const nameOf = (mapping: GroupMapping) =>
    targets.find(
      (t) => t.type === mapping.target.type && t.id === mapping.target.id,
    )?.name ?? mapping.target.id;

  function open(next: DialogState) {
    save.reset();
    remove.reset();
    setDialog(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          <Button
            ref={addButton}
            type="button"
            size="sm"
            onClick={() => open({ kind: "add" })}
          >
            <Plus aria-hidden />
            Add mapping
          </Button>
        </div>
      ) : null}

      {mappings.length === 0 ? (
        <EmptyState title="No group mappings yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group ID</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Role</TableHead>
              {canEdit ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((mapping) => (
              <TableRow key={mapping.groupId}>
                <TableCell className="font-mono">{mapping.groupId}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{nameOf(mapping)}</span>
                    <Badge variant="outline">
                      {mapping.target.type === "team" ? "Team" : "Department"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>{ROLE_LABELS[mapping.scopedRole]}</TableCell>
                {canEdit ? (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit mapping ${mapping.groupId}`}
                        onClick={() => open({ kind: "edit", mapping })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete mapping ${mapping.groupId}`}
                        onClick={() => open({ kind: "delete", mapping })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialog?.kind === "add" || dialog?.kind === "edit" ? (
        <MappingDialog
          returnFocusTo={addButton}
          existing={dialog.kind === "edit" ? dialog.mapping : null}
          targets={targets}
          pending={save.isPending}
          serverError={save.isError ? accessErrorMessage(save.error) : null}
          onSave={(input) =>
            save.mutate(
              dialog.kind === "edit"
                ? { ...input, version: dialog.mapping.version }
                : input,
            )
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title="Delete mapping"
          description={`Delete the mapping for group ${dialog.mapping.groupId}? Its members keep their roles until they next sign in.`}
          confirmLabel="Delete"
          pending={remove.isPending}
          error={remove.isError ? accessErrorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(dialog.mapping)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

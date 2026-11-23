"use client";

import { useId, useState, type FormEvent } from "react";
import type { z } from "zod";

import { NativeSelect } from "@/components/litellm/team/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AccountFieldKey =
  | "accountId"
  | "accountName"
  | "departmentName"
  | "teamName";

export type AccountFormValues = Record<AccountFieldKey, string>;

const FIELDS: ReadonlyArray<{ key: AccountFieldKey; label: string }> = [
  { key: "accountId", label: "AWS account ID" },
  { key: "accountName", label: "Account name" },
  { key: "departmentName", label: "Department name" },
  { key: "teamName", label: "Team name" },
];

export const EMPTY_ACCOUNT_VALUES: AccountFormValues = {
  accountId: "",
  accountName: "",
  departmentName: "",
  teamName: "",
};

// A team pick carries its department: Edit lists only the picked department's
// teams (Design System -- Add account; a team id never crosses departments).
export type RegistryPick = { id: string; name: string; departmentId?: string };

// Ids picked from the registry (Edit): the name inputs follow the pick.
export type AccountPickedIds = { departmentId: string; teamId: string };

type AccountFormProps = {
  initial: AccountFormValues;
  // The shared Zod schema the values are validated against (Rule 60.16).
  schema: z.ZodType;
  submitLabel: string;
  accountIdReadOnly?: boolean;
  pending: boolean;
  serverError: string | null;
  // Names already in the registry, offered as a pick (Design System -- Settings
  // small UX, D-ST5). Picking fills the name; nobody types an internal id.
  existingDepartments?: readonly string[];
  existingTeams?: readonly string[];
  // Edit: the pick is by id and the name inputs are read-only; the initial
  // ids select the account's current department and team.
  registryDepartments?: readonly RegistryPick[];
  registryTeams?: readonly RegistryPick[];
  initialIds?: AccountPickedIds;
  onSubmit: (values: AccountFormValues, ids?: AccountPickedIds) => void;
};

function isFieldKey(key: unknown): key is AccountFieldKey {
  return FIELDS.some((f) => f.key === key);
}

export function AccountForm({
  initial,
  schema,
  submitLabel,
  accountIdReadOnly = false,
  pending,
  serverError,
  existingDepartments = [],
  existingTeams = [],
  registryDepartments,
  registryTeams,
  initialIds,
  onSubmit,
}: AccountFormProps) {
  const formId = useId();
  const [values, setValues] = useState<AccountFormValues>(initial);
  const [ids, setIds] = useState<AccountPickedIds | undefined>(initialIds);
  const [errors, setErrors] = useState<
    Partial<Record<AccountFieldKey, string>>
  >({});

  const teamMissing = registryTeams !== undefined && ids?.teamId === "";

  function pickDepartment(picked: RegistryPick) {
    if (!ids || !initialIds) return;
    const sameAsInitial = picked.id === initialIds.departmentId;
    const keptTeam = sameAsInitial
      ? registryTeams?.find((t) => t.id === initialIds.teamId)
      : undefined;
    setIds({ departmentId: picked.id, teamId: keptTeam?.id ?? "" });
    setValues((prev) => ({
      ...prev,
      departmentName: picked.name,
      teamName: keptTeam?.name ?? "",
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<AccountFieldKey, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (isFieldKey(key) && next[key] === undefined) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit(values, ids);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex max-w-[72ch] flex-col gap-4"
    >
      {FIELDS.map(({ key, label }) => {
        const id = `${formId}-${key}`;
        const error = errors[key];
        const readOnly = key === "accountId" && accountIdReadOnly;
        const registry =
          key === "departmentName"
            ? registryDepartments
            : key === "teamName"
              ? registryTeams?.filter(
                  (t) =>
                    t.departmentId === undefined ||
                    t.departmentId === ids?.departmentId,
                )
              : undefined;
        const idKey = key === "departmentName" ? "departmentId" : "teamId";
        const existing =
          registry !== undefined
            ? []
            : key === "departmentName"
              ? existingDepartments
              : key === "teamName"
                ? existingTeams
                : [];
        const pickLabel =
          key === "departmentName" ? "Existing department" : "Existing team";
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <Input
              id={id}
              value={values[key]}
              readOnly={readOnly || registry !== undefined}
              className="min-w-0"
              aria-invalid={error !== undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
            />
            {registry !== undefined && ids !== undefined ? (
              <>
                <label
                  htmlFor={`${id}-pick`}
                  className="text-muted-foreground text-sm"
                >
                  {pickLabel}
                </label>
                <NativeSelect
                  id={`${id}-pick`}
                  value={ids[idKey]}
                  onChange={(e) => {
                    const picked = registry.find(
                      (r) => r.id === e.target.value,
                    );
                    if (!picked) return;
                    if (key === "departmentName") {
                      pickDepartment(picked);
                      return;
                    }
                    setIds((prev) =>
                      prev ? { ...prev, [idKey]: picked.id } : prev,
                    );
                    setValues((prev) => ({ ...prev, [key]: picked.name }));
                  }}
                >
                  {ids[idKey] === "" ? (
                    <option value="">Pick a team</option>
                  ) : null}
                  {registry.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            ) : null}
            {existing.length > 0 ? (
              <>
                <label
                  htmlFor={`${id}-pick`}
                  className="text-muted-foreground text-sm"
                >
                  {pickLabel}
                </label>
                <NativeSelect
                  id={`${id}-pick`}
                  value=""
                  onChange={(e) => {
                    const picked = e.target.value;
                    if (picked) {
                      setValues((prev) => ({ ...prev, [key]: picked }));
                    }
                  }}
                >
                  <option value="">Pick an existing one</option>
                  {existing.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            ) : null}
            {error ? (
              <p
                id={`${id}-error`}
                role="alert"
                className="text-destructive text-sm"
              >
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      {serverError ? (
        <p role="alert" className="text-destructive text-sm">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || teamMissing}>
        {submitLabel}
      </Button>
    </form>
  );
}

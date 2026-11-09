"use client";

import { useId, useState, type FormEvent } from "react";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AccountFieldKey =
  | "accountId"
  | "accountName"
  | "departmentId"
  | "departmentName"
  | "teamId"
  | "teamName";

export type AccountFormValues = Record<AccountFieldKey, string>;

const FIELDS: ReadonlyArray<{ key: AccountFieldKey; label: string }> = [
  { key: "accountId", label: "Account ID" },
  { key: "accountName", label: "Account name" },
  { key: "departmentId", label: "Department ID" },
  { key: "departmentName", label: "Department name" },
  { key: "teamId", label: "Team ID" },
  { key: "teamName", label: "Team name" },
];

export const EMPTY_ACCOUNT_VALUES: AccountFormValues = {
  accountId: "",
  accountName: "",
  departmentId: "",
  departmentName: "",
  teamId: "",
  teamName: "",
};

type AccountFormProps = {
  initial: AccountFormValues;
  // The shared Zod schema the values are validated against (Rule 60.16).
  schema: z.ZodType;
  submitLabel: string;
  accountIdReadOnly?: boolean;
  pending: boolean;
  serverError: string | null;
  onSubmit: (values: AccountFormValues) => void;
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
  onSubmit,
}: AccountFormProps) {
  const formId = useId();
  const [values, setValues] = useState<AccountFormValues>(initial);
  const [errors, setErrors] = useState<
    Partial<Record<AccountFieldKey, string>>
  >({});

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
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {FIELDS.map(({ key, label }) => {
        const id = `${formId}-${key}`;
        const error = errors[key];
        const readOnly = key === "accountId" && accountIdReadOnly;
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <Input
              id={id}
              value={values[key]}
              readOnly={readOnly}
              aria-invalid={error !== undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [key]: e.target.value }))
              }
            />
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
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

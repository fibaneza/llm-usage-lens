"use client";

import {
  CreateAppTeamInputSchema,
  CreateAppTeamResponseSchema,
  OrgUnitsResponseSchema,
  type AppTeam,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { NativeSelect } from "@/components/litellm/team/native-select";
import {
  FormField,
  FormError,
} from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

const DUPLICATE_NAME = "A team with this name already exists";

type FieldErrors = { name?: string; departmentId?: string };

// Design System - Management pages, New team (D5, D6; unit M2): admin and
// org-admin only (the page decides who gets the trigger; the route refuses
// everyone else with 403). Outline, because the view's one filled primary
// button belongs to the page.
export function TeamCreateDialog({
  onCreated,
}: {
  onCreated: (team: AppTeam) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const units = useQuery({
    queryKey: ["access", "org-units"],
    queryFn: () => fetchApi("/api/access/org-units", OrgUnitsResponseSchema),
    enabled: open,
  });
  const departments = units.data?.departments ?? [];

  const create = useMutation({
    mutationFn: (body: { name: string; departmentId: string }) =>
      mutateApi("/api/teams", "POST", body, CreateAppTeamResponseSchema),
  });

  const reset = () => {
    setName("");
    setDepartmentId("");
    setErrors({});
    setFailure(null);
    create.reset();
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    setFailure(null);
    const parsed = CreateAppTeamInputSchema.safeParse({
      name,
      departmentId,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "name" && !next.name) {
          next.name =
            name.trim().length === 0
              ? "Enter a team name"
              : "Use 80 characters or fewer";
        }
        if (issue.path[0] === "departmentId" && !next.departmentId) {
          next.departmentId = "Choose a department";
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      const team = await create.mutateAsync(parsed.data);
      close();
      onCreated(team);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "CONFLICT") {
        setErrors({ name: DUPLICATE_NAME });
      } else if (error instanceof ApiRequestError && error.status === 400) {
        setErrors({ name: error.message });
      } else if (error instanceof ApiRequestError) {
        setFailure(error.message);
      } else {
        setFailure("Request failed - try again");
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          New team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>
              A team without an AWS account. Members, admins and a LiteLLM link
              are added afterwards.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Team name" error={errors.name}>
            {(props) => (
              <Input
                {...props}
                value={name}
                autoComplete="off"
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Department" error={errors.departmentId}>
            {(props) => (
              <NativeSelect
                {...props}
                value={departmentId}
                disabled={units.isPending}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {units.isError ? (
            <FormError>Couldn&apos;t load departments</FormError>
          ) : null}
          {failure ? <FormError>{failure}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

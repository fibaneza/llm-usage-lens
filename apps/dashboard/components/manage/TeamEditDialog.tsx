"use client";

import {
  AppTeamNameSchema,
  AppTeamSchema,
  OrgUnitsResponseSchema,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
const STALE_TEAM = "This team changed since you opened it. Review and save.";

export type TeamEditTarget = {
  teamId: string;
  name: string;
  departmentId: string;
  version: number;
};

type FieldErrors = { name?: string; departmentId?: string };

// Design System - Team page, round 3 (unit TP1), Edit team; Access Control -
// Edit a created team (T-TP3). The page decides who gets the trigger; the
// route refuses everyone else with 403.
export function TeamEditDialog({ team }: { team: TeamEditTarget }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(team.name);
  const [departmentId, setDepartmentId] = useState(team.departmentId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const units = useQuery({
    queryKey: ["access", "org-units"],
    queryFn: () => fetchApi("/api/access/org-units", OrgUnitsResponseSchema),
    enabled: open,
  });
  const departments = units.data?.departments ?? [];

  const update = useMutation({
    mutationFn: (body: {
      name: string;
      departmentId: string;
      version: number;
    }) =>
      mutateApi(
        `/api/teams/${encodeURIComponent(team.teamId)}`,
        "PATCH",
        body,
        AppTeamSchema,
      ),
  });

  const reset = () => {
    setName(team.name);
    setDepartmentId(team.departmentId);
    setErrors({});
    setFailure(null);
    update.reset();
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    setFailure(null);
    const parsedName = AppTeamNameSchema.safeParse(name);
    if (!parsedName.success) {
      setErrors({
        name:
          name.trim().length === 0
            ? "Enter a team name"
            : "Use 80 characters or fewer",
      });
      return;
    }
    if (departmentId === "") {
      setErrors({ departmentId: "Choose a department" });
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync({
        name: parsedName.data,
        departmentId,
        version: team.version,
      });
      close();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        if (error.message === DUPLICATE_NAME) {
          setErrors({ name: DUPLICATE_NAME });
        } else {
          setFailure(STALE_TEAM);
          router.refresh();
        }
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
          Edit team
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
            <DialogTitle>Edit team</DialogTitle>
            <DialogDescription>
              Rename the team or move it to another department.
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
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

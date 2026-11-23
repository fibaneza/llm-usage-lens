"use client";

import type { OrgUnits } from "@llm-usage-lens/shared";
import { useState } from "react";

import {
  FormError,
  FormField,
  NativeSelect,
} from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The destination picker for POST /api/affiliations/[oid]/move (Access
// Control - Membership, Mover: atomic move).
export function MoveTeamDialog({
  fromTeamId,
  teams,
  pending,
  error,
  onMove,
  onClose,
}: {
  fromTeamId: string;
  teams: OrgUnits["teams"];
  pending: boolean;
  error: string | null;
  onMove: (toTeamId: string) => void;
  onClose: () => void;
}) {
  const options = teams.filter((t) => t.id !== fromTeamId);
  const [chosen, setChosen] = useState<string | null>(null);
  const destination = chosen ?? options[0]?.id ?? "";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to another team</DialogTitle>
          <DialogDescription>
            Moves the person to another team in one step.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Destination team">
          {(props) => (
            <NativeSelect
              {...props}
              value={destination}
              onChange={(e) => setChosen(e.target.value)}
            >
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {error ? <FormError>{error}</FormError> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || destination === ""}
            onClick={() => onMove(destination)}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent } from "react";

import { FormField } from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// One list of keys (usage identities or aliases) with, for an editor, add and
// remove. Keys are exact and lower-case (Access Control - Canonical usage
// identity).
export type KeyKind = "usage identity" | "alias";

export function UserKeyList({
  heading,
  kind,
  keys,
  canEdit,
  onAdd,
  onRemove,
}: {
  heading: string;
  kind: KeyKind;
  keys: readonly string[];
  canEdit: boolean;
  onAdd: (key: string) => string | null;
  onRemove: (key: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  function add() {
    const problem = onAdd(value);
    setError(problem ?? undefined);
    if (problem === null) setValue("");
  }

  return (
    <div className="flex max-w-[72ch] flex-col gap-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      {keys.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {keys.map((key) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{key}</span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${kind} ${key}`}
                  onClick={() => onRemove(key)}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label={`New ${kind}`} error={error}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                />
              )}
            </FormField>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus aria-hidden />
            {`Add ${kind}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The key value lives in this component's state only: closing it drops the
// value, and it is never put in the query cache or fetched again (LiteLLM
// spec -- Writes, generateMemberKey).
export function ShownOnceKeyDialog({
  value,
  returnFocusRef,
  onClose,
}: {
  value: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Key generated</DialogTitle>
          <DialogDescription>
            Copy the key now. You will not see this again.
          </DialogDescription>
        </DialogHeader>
        <code className="bg-muted block rounded-md p-3 font-mono text-sm break-all">
          {value}
        </code>
        {copyFailed ? (
          <p role="alert" className="text-destructive text-sm">
            The key could not be copied. Select it and copy it by hand.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(value).then(
                () => setCopyFailed(false),
                () => setCopyFailed(true),
              );
            }}
          >
            Copy key
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

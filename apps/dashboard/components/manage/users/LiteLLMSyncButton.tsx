"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { LiteLLMSyncDialog } from "@/components/manage/users/LiteLLMSyncDialog";
import { Button } from "@/components/ui/button";

// Design System - "Sync from LiteLLM": the page decides on the server whether
// the caller may see the button (Rule 10.3); this component only opens the dialog.
export function LiteLLMSyncButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <RefreshCw aria-hidden />
        Sync from LiteLLM
      </Button>
      {open ? <LiteLLMSyncDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

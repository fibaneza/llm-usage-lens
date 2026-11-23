"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { TeamCreateDialog } from "./TeamCreateDialog";

// The one client part of the Team list (Design System - "List, then the team",
// D-TM4): New team opens the created team's page.
export function TeamCreateTrigger() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <TeamCreateDialog
      onCreated={(created) => {
        void queryClient.invalidateQueries({ queryKey: ["litellm", "me"] });
        void queryClient.invalidateQueries({
          queryKey: ["access", "org-units"],
        });
        router.push(
          `/dashboard/manage/team/${encodeURIComponent(created.teamId)}`,
        );
      }}
    />
  );
}

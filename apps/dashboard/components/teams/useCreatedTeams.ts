"use client";

import { useQuery } from "@tanstack/react-query";
import { OrgUnitsResponseSchema } from "@llm-usage-lens/shared";

import { fetchApi } from "@/lib/query/fetch-api";

export function useCreatedTeams() {
  return useQuery({
    queryKey: ["usage", "created-teams"],
    queryFn: async () => {
      const response = await fetchApi(
        "/api/access/org-units",
        OrgUnitsResponseSchema,
      );
      const departments = new Map(
        response.departments.map((d) => [d.id, d.name]),
      );
      return {
        teams: response.teams
          .filter((team) => !team.hasAwsAccount)
          .map((team) => ({
            teamId: team.id,
            teamName: team.name,
            departmentId: team.departmentId,
            departmentName: departments.get(team.departmentId) ?? null,
          })),
      };
    },
  });
}

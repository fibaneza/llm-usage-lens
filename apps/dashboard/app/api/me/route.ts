import { jsonData, withRoute } from "@/lib/api/respond";
import { MeResponseSchema, ownUsageKeys } from "@/lib/api/me";
import { scopeFor } from "@/lib/api/scoped-rollups";

export const GET = withRoute(async (_request, _ctx, session) => {
  const scope = await scopeFor(session, []);
  const email = session.user.email ?? null;
  return jsonData(
    MeResponseSchema.parse({
      oid: session.user.oid,
      email,
      roles: session.user.roles ?? [],
      usageIdentities: [...ownUsageKeys(scope, email)].sort(),
    }),
  );
});

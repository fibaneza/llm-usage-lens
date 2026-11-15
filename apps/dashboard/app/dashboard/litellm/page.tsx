import { auth } from "@/auth";
import { LiteLLMContent } from "@/components/litellm/LiteLLMContent";
import { adminOrAuditorRefusal } from "@/lib/litellm/route-guard";

// The audit section is for Admin and Auditor only (LiteLLM spec -- Page and
// Settings). The role is resolved on the server and passed down (Rule 10.3,
// 50.3); the audit route enforces it again.
export default async function LiteLLMPage() {
  const session = await auth();
  const canViewAudit = (await adminOrAuditorRefusal(session)) === null;
  return <LiteLLMContent canViewAudit={canViewAudit} />;
}

import { redirect } from "next/navigation";

// The Audit tab left Settings: its sections are Management -> Audit (slice B2,
// B2-3). The target applies its own gate.
export default function SettingsAuditRedirectPage() {
  redirect("/dashboard/manage/audit");
}

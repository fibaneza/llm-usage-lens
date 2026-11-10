import { trace } from "@opentelemetry/api";

// Source: docs/specs/2026-11-10-access-control.md — "Threat model" T20,
// "Audit log". Id-only event: never the username, password, code or hash
// (Rule 50.6). R2 wires the persistent audit record.
export type SecurityEvent = {
  action:
    | "auth.master.signin"
    | "auth.master.failure"
    | "auth.master.lockout"
    | "auth.signin.error";
  result: "success" | "failed";
  oid?: string;
  at: string;
};

export function recordSecurityEvent(event: SecurityEvent): void {
  const attributes = {
    action: event.action,
    result: event.result,
    at: event.at,
    ...(event.oid ? { oid: event.oid } : {}),
  };
  const name = `security.${event.action}`;
  const active = trace.getActiveSpan();
  if (active) {
    active.addEvent(name, attributes);
    return;
  }
  const span = trace.getTracer("llm-usage-lens-auth").startSpan(name);
  span.addEvent(name, attributes);
  span.end();
}

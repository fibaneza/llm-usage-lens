import { registerOTel } from "@vercel/otel";

import { env } from "@/env";

// OTLP export of traces/metrics to the devcontainer Collector (Prometheus +
// Loki + Grafana), Grafana Cloud free tier in production. Endpoint and service
// name come from OTEL_* env vars. See implementation-phases spec §Phase 1.
export async function register() {
  registerOTel({
    serviceName: env.OTEL_SERVICE_NAME,
  });

  // Validate config/litellm-gateway.json at server start so an invalid file
  // fails startup (spec litellm "Guardrail configuration", LD19; Rule 60.19).
  // Node runtime only; dynamic import keeps the edge runtime unaffected.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/litellm/gateway-config");
  }
}

// Capture server-side request errors (Next.js onRequestError hook) on the
// active span so failures surface in OpenTelemetry rather than being swallowed
// (Rule 60.17).
export async function onRequestError(error: unknown) {
  const { trace } = await import("@opentelemetry/api");
  trace
    .getActiveSpan()
    ?.recordException(error instanceof Error ? error : String(error));
}

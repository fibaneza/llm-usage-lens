import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: () => auth() }));

import {
  BadRequestError,
  NotFoundError,
  jsonData,
  withRoute,
} from "@/lib/api/respond";
import { installFakeOtel, recordedSpans } from "@/test/otel-fake";

// Source: Rule 60.17/60.18 (errors reach OpenTelemetry via a span started in
// withRoute so recordException always lands); Rule 50.6 (no secrets in
// telemetry). Uses a recording
// tracer provider registered on the real @opentelemetry/api.
const SECRET = "s3cr3t-auth-value-9f2";
const BEARER = "tok-abc-123";
const ctx = { params: Promise.resolve({}) };
const req = () =>
  new Request("http://localhost/api/x?token=qs-secret", {
    headers: { authorization: `Bearer ${BEARER}`, cookie: `sid=${SECRET}` },
  });

const savedEnv = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
};
beforeAll(() => {
  installFakeOtel();
  process.env.AUTH_SECRET = SECRET;
  process.env.AWS_SECRET_ACCESS_KEY = SECRET;
});
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
beforeEach(() => {
  recordedSpans.length = 0;
  auth.mockReset();
  auth.mockResolvedValue({ user: { oid: "oid-test", name: "t" } });
});

describe("withRoute span", () => {
  it("runs the handler inside an active span", async () => {
    let active: unknown;
    await withRoute(async () => {
      active = trace.getActiveSpan();
      return jsonData(1);
    })(req(), ctx);
    expect(active).toBeDefined();
    expect(recordedSpans.length).toBeGreaterThanOrEqual(1);
    expect(recordedSpans.every((s) => s.ended)).toBe(true);
    expect(
      recordedSpans.some((s) => s.status.code === SpanStatusCode.ERROR),
    ).toBe(false);
  });

  it("an unexpected error is recorded on the span and marks it ERROR", async () => {
    const boom = new Error("boom");
    const res = await withRoute(async () => {
      throw boom;
    })(req(), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL", message: "Internal server error" },
    });
    const errored = recordedSpans.filter((s) => s.exceptions.includes(boom));
    expect(errored).toHaveLength(1);
    expect(errored[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(errored[0]?.ended).toBe(true);
  });

  it("records a non-Error throw too", async () => {
    const res = await withRoute(async () => {
      throw "plain string";
    })(req(), ctx);
    expect(res.status).toBe(500);
    expect(recordedSpans.some((s) => s.exceptions.length === 1)).toBe(true);
  });

  it("expected 400 and 404 outcomes are not recorded as exceptions", async () => {
    const bad = await withRoute(async () => {
      throw new BadRequestError([]);
    })(req(), ctx);
    const missing = await withRoute(async () => {
      throw new NotFoundError("nope");
    })(req(), ctx);
    expect([bad.status, missing.status]).toEqual([400, 404]);
    expect(recordedSpans.flatMap((s) => s.exceptions)).toEqual([]);
    expect(
      recordedSpans.some((s) => s.status.code === SpanStatusCode.ERROR),
    ).toBe(false);
  });

  it("puts no secrets, env values or credentials in span attributes", async () => {
    await withRoute(async () => {
      throw new Error("boom");
    })(req(), ctx);
    const dump = JSON.stringify(recordedSpans.map((s) => s.attributes));
    for (const secret of [SECRET, BEARER, "qs-secret"]) {
      expect(dump).not.toContain(secret);
    }
  });
});

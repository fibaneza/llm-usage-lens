// Test-only OpenTelemetry provider: registers a global context manager and
// tracer provider that record spans in memory so tests can assert on the real
// `@opentelemetry/api` surface (getActiveSpan, startActiveSpan, startSpan +
// context.with all work). Not imported by production code.
import { AsyncLocalStorage } from "node:async_hooks";

import {
  context,
  ROOT_CONTEXT,
  trace,
  type Context,
  type ContextManager,
  type Span,
  type SpanStatus,
  type Tracer,
} from "@opentelemetry/api";

export type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  exceptions: unknown[];
  status: SpanStatus;
  ended: boolean;
};

export const recordedSpans: RecordedSpan[] = [];

class AlsContextManager implements ContextManager {
  private als = new AsyncLocalStorage<Context>();
  active(): Context {
    return this.als.getStore() ?? ROOT_CONTEXT;
  }
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(ctx, () => fn.call(thisArg, ...args));
  }
  bind<T>(_ctx: Context, target: T): T {
    return target;
  }
  enable(): this {
    return this;
  }
  disable(): this {
    return this;
  }
}

function makeSpan(name: string): Span {
  const rec: RecordedSpan = {
    name,
    attributes: {},
    exceptions: [],
    status: { code: 0 },
    ended: false,
  };
  recordedSpans.push(rec);
  const span: Span = {
    spanContext: () => ({
      traceId: "0".repeat(31) + "1",
      spanId: "0".repeat(15) + "1",
      traceFlags: 1,
    }),
    setAttribute: (k, v) => ((rec.attributes[k] = v), span),
    setAttributes: (a) => (Object.assign(rec.attributes, a), span),
    addEvent: () => span,
    addLink: () => span,
    addLinks: () => span,
    setStatus: (s) => ((rec.status = s), span),
    updateName: (n) => ((rec.name = n), span),
    end: () => {
      rec.ended = true;
    },
    isRecording: () => !rec.ended,
    recordException: (e) => {
      rec.exceptions.push(e);
    },
  };
  return span;
}

const tracer: Tracer = {
  startSpan: (name) => makeSpan(name),
  startActiveSpan: ((name: string, ...rest: unknown[]) => {
    const fn = rest[rest.length - 1] as (span: Span) => unknown;
    const span = makeSpan(name);
    return context.with(trace.setSpan(context.active(), span), () => fn(span));
  }) as Tracer["startActiveSpan"],
};

let installed = false;
export function installFakeOtel(): void {
  if (installed) return;
  installed = true;
  context.setGlobalContextManager(new AlsContextManager());
  trace.setGlobalTracerProvider({ getTracer: () => tracer });
}

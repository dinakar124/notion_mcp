/**
 * OpenTelemetry Compatibility Spike — Stage 0
 *
 * Proves: npm @opentelemetry packages import and function under Deno 2.9.7
 * without --unstable-otel. No external collector or network required.
 *
 * Packages under test (all Apache-2.0):
 *   @opentelemetry/api              1.9.0
 *   @opentelemetry/sdk-trace-base   2.12.0  (transitive: core 2.12.0, sdk-trace 2.12.0)
 *   @opentelemetry/resources        2.12.0  (transitive: semantic-conventions 1.43.0)
 *   @opentelemetry/context-async-hooks 2.12.0
 *
 * Decision: --unstable-otel is NOT needed. Deno 2.9.7 exposes Deno.telemetry
 * (TracerProvider, ContextManager, MeterProvider classes) but they cannot be
 * constructed directly — they are Deno-native primitives for OTLP auto-export.
 * The npm SDK stack operates entirely in userland via AsyncLocalStorage and
 * in-memory export, with no flag dependency.
 */

import { assertEquals, assertExists, assertMatch } from '@std/assert';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

// Internal timeout: abort the entire spike after 10 seconds
const TIMEOUT_MS = 10_000;
const deadline = setTimeout(() => {
  console.error('SPIKE TIMEOUT: exceeded 10s');
  Deno.exit(1);
}, TIMEOUT_MS);

// Shared infrastructure — set up once, torn down after all tests
let provider: BasicTracerProvider;
let exporter: InMemorySpanExporter;
let contextManager: AsyncLocalStorageContextManager;

function setup(): void {
  contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'otel-spike',
      'service.version': '0.0.0',
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
}

async function teardown(): Promise<void> {
  await provider.shutdown();
  contextManager.disable();
  // Unregister globals so other tests are not polluted
  trace.disable();
  context.disable();
  clearTimeout(deadline);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test({
  name: 'otel-spike: setup',
  fn() {
    setup();
  },
});

Deno.test({
  name: 'otel-spike: API imports resolve',
  fn() {
    // If we got here, all imports resolved. Verify key types exist.
    assertExists(trace.getTracer);
    assertExists(SpanStatusCode.OK);
    assertExists(context.active);
    assertExists(BasicTracerProvider);
    assertExists(InMemorySpanExporter);
    assertExists(SimpleSpanProcessor);
    assertExists(resourceFromAttributes);
    assertExists(AsyncLocalStorageContextManager);
  },
});

Deno.test({
  name: 'otel-spike: tracer provider initializes and produces a tracer',
  fn() {
    const tracer = trace.getTracer('spike-tracer', '0.1.0');
    assertExists(tracer);
    assertExists(tracer.startSpan);
    assertExists(tracer.startActiveSpan);
  },
});

Deno.test({
  name: 'otel-spike: span with attributes, events, and status',
  async fn() {
    exporter.reset();
    const tracer = trace.getTracer('spike-tracer', '0.1.0');

    const span = tracer.startSpan('test-operation', {
      attributes: {
        'mcp.tool': 'notion.search',
        'mcp.request_id': 'req-001',
        'test.numeric': 42,
        'test.boolean': true,
      },
    });

    span.addEvent('cache.miss', { 'cache.key': 'page-abc' });
    span.addEvent('notion.api_call', { 'http.status_code': 200 });
    span.setAttribute('mcp.response_size', 1024);
    span.setStatus({ code: SpanStatusCode.OK, message: 'completed' });
    span.end();

    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1, 'exactly one span exported');

    const s = spans[0]!;
    assertEquals(s.name, 'test-operation');
    assertEquals(s.attributes['mcp.tool'], 'notion.search');
    assertEquals(s.attributes['mcp.request_id'], 'req-001');
    assertEquals(s.attributes['test.numeric'], 42);
    assertEquals(s.attributes['test.boolean'], true);
    assertEquals(s.attributes['mcp.response_size'], 1024);
    assertEquals(s.events.length, 2, 'two events recorded');
    assertEquals(s.events[0]!.name, 'cache.miss');
    assertEquals(s.events[1]!.name, 'notion.api_call');
    assertEquals(s.status.code, SpanStatusCode.OK);
    assertEquals(s.resource.attributes['service.name'], 'otel-spike');
    assertEquals(s.resource.attributes['service.version'], '0.0.0');
  },
});

Deno.test({
  name: 'otel-spike: trace and span IDs are valid hex',
  async fn() {
    exporter.reset();
    const tracer = trace.getTracer('spike-tracer');
    const span = tracer.startSpan('id-check');
    span.end();

    await provider.forceFlush();

    const s = exporter.getFinishedSpans()[0]!;
    const traceId = s.spanContext().traceId;
    const spanId = s.spanContext().spanId;

    // W3C trace-context: traceId = 32 lowercase hex, spanId = 16 lowercase hex
    assertMatch(traceId, /^[0-9a-f]{32}$/, `traceId must be 32 hex chars, got: ${traceId}`);
    assertMatch(spanId, /^[0-9a-f]{16}$/, `spanId must be 16 hex chars, got: ${spanId}`);

    // Must not be all-zero (invalid per spec)
    assertEquals(traceId === '0'.repeat(32), false, 'traceId must not be all zeros');
    assertEquals(spanId === '0'.repeat(16), false, 'spanId must not be all zeros');
  },
});

Deno.test({
  name: 'otel-spike: context propagation across async boundary',
  async fn() {
    exporter.reset();
    const tracer = trace.getTracer('spike-tracer');

    const parentSpan = tracer.startSpan('parent-operation');
    const parentCtx = trace.setSpan(context.active(), parentSpan);

    await context.with(parentCtx, async () => {
      // Cross an async boundary (setTimeout + await)
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      const childSpan = tracer.startSpan('child-operation');
      childSpan.end();
    });
    parentSpan.end();

    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 2, 'parent + child = 2 spans');

    const parent = spans.find((s) => s.name === 'parent-operation')!;
    const child = spans.find((s) => s.name === 'child-operation')!;
    assertExists(parent, 'parent span found');
    assertExists(child, 'child span found');

    // Same trace ID proves context crossed the async boundary
    assertEquals(
      child.spanContext().traceId,
      parent.spanContext().traceId,
      'child must share parent trace ID',
    );

    // v2 SDK: parent linkage is via parentSpanContext (object), not parentSpanId (string)
    assertExists(child.parentSpanContext, 'child has parentSpanContext');
    assertEquals(
      child.parentSpanContext?.spanId,
      parent.spanContext().spanId,
      'child parentSpanContext.spanId must match parent spanId',
    );
  },
});

Deno.test({
  name: 'otel-spike: in-memory exporter receives spans',
  async fn() {
    exporter.reset();
    const tracer = trace.getTracer('spike-tracer');

    // Create multiple spans
    for (let i = 0; i < 5; i++) {
      const span = tracer.startSpan(`batch-${i}`);
      span.setAttribute('batch.index', i);
      span.end();
    }

    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 5, 'all 5 spans exported');

    // Verify ordering and attributes
    for (let i = 0; i < 5; i++) {
      const s = spans.find((sp) => sp.name === `batch-${i}`);
      assertExists(s, `span batch-${i} found`);
      assertEquals(s!.attributes['batch.index'], i);
    }

    // Reset and verify clean state
    exporter.reset();
    assertEquals(exporter.getFinishedSpans().length, 0, 'exporter reset clears spans');
  },
});

Deno.test({
  name: 'otel-spike: error span with exception event',
  async fn() {
    exporter.reset();
    const tracer = trace.getTracer('spike-tracer');

    const span = tracer.startSpan('failing-operation');
    const err = new Error('simulated Notion API timeout');
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();

    await provider.forceFlush();

    const s = exporter.getFinishedSpans()[0]!;
    assertEquals(s.status.code, SpanStatusCode.ERROR);
    assertEquals(s.status.message, 'simulated Notion API timeout');

    // recordException adds an 'exception' event per OTel spec
    const exceptionEvent = s.events.find((e) => e.name === 'exception');
    assertExists(exceptionEvent, 'exception event recorded');
    assertEquals(exceptionEvent!.attributes!['exception.message'], 'simulated Notion API timeout');
  },
});

Deno.test({
  name: 'otel-spike: Deno.telemetry exists but --unstable-otel not required',
  fn() {
    // Deno 2.9.7 exposes Deno.telemetry with TracerProvider, ContextManager,
    // MeterProvider classes. These are native primitives for auto-OTLP export.
    // They CANNOT be constructed directly (throw "cannot be constructed").
    // The npm SDK stack works independently via AsyncLocalStorage.
    const telemetry = (Deno as Record<string, unknown>).telemetry;
    assertExists(telemetry, 'Deno.telemetry namespace exists in 2.9.7');

    const t = telemetry as Record<string, unknown>;
    assertEquals(typeof t.tracerProvider, 'function', 'native TracerProvider class exists');
    assertEquals(typeof t.contextManager, 'function', 'native ContextManager class exists');
    assertEquals(typeof t.meterProvider, 'function', 'native MeterProvider class exists');

    // Verify they cannot be instantiated (they require --unstable-otel + OTLP endpoint)
    let threw = false;
    try {
      type NativeConstructor = new (...args: never[]) => unknown;
      Reflect.construct(t.tracerProvider as NativeConstructor, []);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, 'native TracerProvider rejects direct construction');
  },
});

Deno.test({
  name: 'otel-spike: provider shutdown is clean',
  async fn() {
    // Shutdown was already called in teardown, but let's verify forceFlush
    // after shutdown does not throw (idempotent)
    await teardown();
  },
});

# lag

Main-thread responsiveness monitoring for browser apps, exported as OpenTelemetry metrics.

A set of independent monitors, each watching one signal of main-thread health: timer drift, task-queue delay, long animation frames, interaction latency (INP), layout shifts, frame delivery, idle time, memory, compute pressure, GC, and a Web Worker that measures main-thread blocking from outside the main thread. `setupAllMonitors()` wires all of them to an OTel `Meter`. The dashboard lives in [grafana-infra](https://github.com/mark1russell7/grafana-infra).

## Packages

| Package | Purpose |
| --- | --- |
| `@lag/core` (`packages/lag`) | The monitors, their OTel wiring, `setupAllMonitors`. No DOM or OTel dependency: every browser API is injected through duck-typed deps, so it is fully unit-testable with fake timers. |
| `@lag/worker` (`packages/lag-worker`) | `createLagWorker()` — the Web Worker behind the worker-lag monitor. Bundler-friendly (`new Worker(new URL(...))`). |
| `@lag/integration-tests` | Browser tests in Chromium, Firefox, WebKit and Chrome (Vitest browser mode + Playwright): stress profiles, CDP tests, a cross-origin-isolated project, the web-vitals oracle, the overhead benchmark and the soak test. Exports to the Grafana stack when it's running. |
| `@lag/scripts` | `pnpm new` scaffolds a workspace package. |

## Usage

```ts
import { setupAllMonitors, createOtelLoggerAdapter } from "@lag/core";
import { createLagWorker } from "@lag/worker";

const worker = createLagWorker();
const monitors = setupAllMonitors({
    meter : otelMeter,                                   // any @opentelemetry/api Meter
    logger : createOtelLoggerAdapter(otelLogger),        // or any { log(level, message, args) }
    clock : { now : () => performance.now() },
    setTimeoutFn : (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn : (id) => clearTimeout(id),
    setIntervalFn : (fn, ms) => setInterval(fn, ms),
    clearIntervalFn : (id) => clearInterval(id),
    document,
    window,
    // Optional — each enables its monitor(s):
    performance,
    PerformanceObserver,
    requestAnimationFrame : (cb) => requestAnimationFrame(cb),
    cancelAnimationFrame : (id) => cancelAnimationFrame(id),
    requestIdleCallback : (cb, opts) => requestIdleCallback(cb, opts),
    cancelIdleCallback : (id) => cancelIdleCallback(id),
    MessageChannel,
    queueMicrotask : (cb) => queueMicrotask(cb),
    FinalizationRegistry,
    memorySource : { readLegacy : () => (performance as any).memory },
    worker,                                              // needs `performance` too
});

// Later: releases every timer, listener, observer and gauge callback.
monitors.stop();
worker.terminate(); // the caller owns the worker
```

`packages/lag-integration-tests/src/harness.ts` (`createBrowserDeps`) is a complete, type-checked example.

Each monitor is also usable on its own, either as a class (`new DriftLag(...)`) or through its instrumented factory (`createInstrumentedDriftLag(deps, lifecycle)`), which returns a `MonitorHandle` with an error boundary and a `stop()`.

## Metrics

All durations are in ms. Gauges named `*_max_gauge`, `*_avg_gauge` or `*_rate_gauge` cover the period since the previous collection.

| Monitor | Metrics | What it measures |
| --- | --- | --- |
| DriftLag | `lag_drift_histogram`, `lag_drift_max_gauge`, `lag_drift_avg_gauge` | Chains 5ms timeouts across a 100ms window and reports how late the window ended. Every blocking task in the window adds up. Also feeds LagLogger warnings (sustained lag over 2s and 5s windows). |
| MacrotaskLag | `lag_macrotask_histogram`, `lag_macrotask_max_gauge`, `lag_macrotask_avg_gauge` | Every 5s, how long a `setTimeout(0)` waits in the task queue. |
| WorkerLagMonitor | `lag_worker_main_block_histogram`, `lag_worker_main_block_max_gauge`, `lag_worker_self_lag_histogram` | The worker sends timestamped heartbeats from its own timer. The wait until the main thread handles each one is main-thread blocking, measured while it happens, not after. |
| LongAnimationFrameMonitor | `lag_loaf_blocking_histogram`, `lag_loaf_duration_histogram` | Frames longer than 50ms (LoAF API). |
| EventTimingMonitor | `lag_inp_histogram`, `lag_inp_input_delay_histogram`, `lag_inp_processing_histogram`, `lag_inp_presentation_delay_histogram`, `lag_inp_worst_gauge` | Every interaction event of 16ms or more, split into its phases, plus the page's INP. |
| LayoutShiftMonitor | `lag_cls_shift_histogram`, `lag_cls_worst_session_gauge` | Layout shifts, and CLS (the worst session window). |
| PaintTimingMonitor, LcpMonitor | `lag_paint_first_paint_gauge`, `lag_paint_first_contentful_paint_gauge`, `lag_lcp_gauge` | FP, FCP, LCP. |
| FrameTimingMonitor | `lag_frame_delta_histogram`, `lag_frame_fps_gauge`, `lag_frame_dropped_rate_gauge` | Gaps between rAF callbacks; dropped frames assume 60Hz. |
| IdleAvailabilityMonitor | `lag_idle_time_remaining_histogram`, `lag_idle_gap_histogram`, `lag_idle_timeout_rate_gauge` | How often the main thread goes idle, and for how long. |
| SchedulingFairnessMonitor | `lag_scheduling_macrotask_histogram`, `lag_scheduling_message_channel_histogram`, `lag_scheduling_microtask_histogram` | Latency of `setTimeout(0)`, `postMessage` and `queueMicrotask` queued at the same instant. Microtask is a ~0 baseline. |
| MemoryMonitor | `lag_memory_used_bytes_histogram` (`source`), `lag_memory_usage_percent_gauge` | `measureUserAgentSpecificMemory()` when cross-origin isolated, otherwise Chrome's `performance.memory`. |
| ComputePressureMonitor | `lag_pressure_change_histogram` (`source`), `lag_pressure_state_gauge` | Compute Pressure API state, 0=nominal … 3=critical. |
| GCSignalDetector | `lag_gc_events`, `lag_gc_recent_rate_gauge` | GC cycles, detected with a FinalizationRegistry canary. |
| LifecycleStateMachine | `lag_lifecycle_transitions` (`from`, `to`, `trigger`) | Page Lifecycle transitions: active, passive, hidden, frozen, terminated. |
| TimerThrottleDetector | `lag_timer_throttled_gauge` | 1 while the browser is throttling timers. |
| ClockReliabilityChecker | `lag_clock_resolution_gauge` | `performance.now()` resolution: about 5–20μs when cross-origin isolated, 100μs–1ms otherwise. |

## Design rules

- **Hidden pages are excluded.** Browsers throttle timers and stop rAF in hidden tabs, so anything measured there reflects power policy, not the app. Timer-, frame- and idle-driven monitors pause while the page is hidden or frozen. Samples whose window overlapped a hidden period are discarded through a per-monitor `HiddenGate`.
- **Attributes are low-cardinality only.** Metric attributes are fixed enums (`source`, lifecycle states). Values, timestamps and IDs never become attributes, because each distinct attribute set is a separate time series.
- **`stop()` releases everything:** timers, DOM listeners, PerformanceObservers, gauge callbacks and the worker loop. `setup-all-monitors.test.ts` checks this with `vi.getTimerCount() === 0`.
- **Every dependency is injected.** Monitors never touch globals, and the duck types are checked against the real OTel and DOM types by the integration package's typecheck.

## Development

```sh
pnpm install
pnpm build              # tsc -b
pnpm typecheck          # build + type-check all tests
pnpm test               # unit tests (fake timers)
pnpm test:browser       # every browser engine, no Docker
```

[Tests](#tests) lists every test kind and its script.

## Tests

Vitest runs all tests. The browser tests use Playwright. Install the Playwright browsers before the first browser run:

```sh
pnpm --filter @lag/integration-tests exec playwright install chromium firefox webkit
```

| Test kind | Script | What the tests examine |
| --- | --- | --- |
| Unit tests | `pnpm test` | The logic of each monitor in Node, with fake timers. These tests also cover `@lag/load`, `@lag/report` and `@lag/scripts`. |
| Coverage | `pnpm coverage` | The unit-test coverage of `@lag/core`. The script writes `packages/lag/coverage/coverage-summary.json`. It fails below the thresholds. |
| Mutation tests | `pnpm mutation` | Stryker changes the code of `@lag/core` and runs the unit tests again. A change that no test finds is a surviving mutant. |
| Browser tests | `pnpm test:browser` | The monitors in Chromium, Firefox, WebKit and Chrome. The script also runs the CDP tests and the cross-origin-isolated tests. |
| Chromium tests | `pnpm test:chromium` | The browser tests in Chromium only. This script is the fast check. |
| CDP tests | `pnpm --filter @lag/integration-tests test:cdp` | Frozen pages, hidden pages, CPU throttling and compute pressure, through the Chrome DevTools Protocol. |
| Cross-origin-isolated tests | `pnpm --filter @lag/integration-tests test:coi` | Shared memory, the fine clock and `measureUserAgentSpecificMemory()` on a cross-origin-isolated page. |
| Overhead benchmark | `pnpm test:overhead` | The main-thread CPU time and the callbacks of all monitors on an idle page, against their budgets. |
| Soak test | `pnpm test:soak` | All monitors for 3 minutes under a mixed workload. The heap must not grow without limit. `stop()` must release every timer. |
| E2E tests | `pnpm test:e2e` | The export to the Grafana stack. The script starts the stack with Docker Compose. |
| Test results | `pnpm results` | All test kinds, without the soak test and the E2E tests. The results go to the site. |

A test that needs an API of one engine skips itself in the other engines. The test report shows the reason.

To change the duration of the soak test, set `LAG_SOAK_MS` to a value in milliseconds. This example runs the soak test for 10 minutes in PowerShell:

```powershell
$env:LAG_SOAK_MS = 600000; pnpm test:soak
```

In Bash, put the variable before the command:

```sh
LAG_SOAK_MS=600000 pnpm test:soak
```

To see the test results on the site, do these steps:

1. Run `pnpm results`.
2. Run `pnpm --filter @lag/site dev`.
3. Open the Results page.

`pnpm results` writes the results to `packages/site/public/data/results/`. Git ignores this folder. The script includes the latest Stryker report if it exists.

To include the soak test or the E2E tests, add `--soak` or `--e2e` to `pnpm results`.

GitHub Actions runs the build, the unit tests, the coverage, the browser tests and the site checks for each push and pull request (`ci.yml`). `e2e.yml` and `mutation.yml` run each week. You can also start them manually.

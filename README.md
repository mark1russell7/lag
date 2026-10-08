# lag

The library measures the lag of the main thread in browser apps, on the devices of real users. It exports the results as OpenTelemetry metrics and events.

Each monitor measures one signal, for example blocked time, queueing delay, hangs, frame delays, input latency (INP) or the Core Web Vitals of each page view. The library calibrates each probe against the browser and the operating system. It discards each sample that a hidden page, a frozen page or a system suspend makes incorrect.

The website in `packages/site` has the documentation, the thesis, the research and the test results.

## Packages

| Package | Folder | What it does |
| --- | --- | --- |
| `@lag/core` | `packages/lag` | The monitors, the measurement conditions, the metric catalog, the browser adapter and `setupAllMonitors()`. It has no DOM or OpenTelemetry dependency. |
| `@lag/worker` | `packages/lag-worker` | The Web Worker of the worker-lag monitor. It sends heartbeats, detects hangs and keeps the hang journal in IndexedDB. |
| `@lag/load` | `packages/load` | Synthetic main-thread load for the tests and the playground. |
| `@lag/report` | `packages/report` | The data format of the test reports, and the converters from Vitest, Istanbul and Stryker. |
| `@lag/site` | `packages/site` | The website. |
| Integration tests | `packages/lag-integration-tests` | The browser tests in Chromium, Firefox, WebKit and Chrome (Vitest browser mode and Playwright): stress profiles, CDP tests, a cross-origin-isolated project, the web-vitals oracle, the overhead benchmark and the soak test. |
| Scripts | `packages/scripts` | `pnpm new`, `pnpm results`, `pnpm readme:metrics` and the other scripts of the repository. |

## Usage

```ts
import { init } from "@mark1russell7/otel-ts";
import { createBrowserDeps, createOtelEventSink, createOtelLoggerAdapter, setupAllMonitors } from "@lag/core";
import { createLagWorker } from "@lag/worker";

const otel = init({ serviceName : "shop", endpoint : "http://localhost:4318", histogramAggregation : "exponential" });

const worker = createLagWorker();
const monitors = setupAllMonitors(createBrowserDeps(window, {
    meter : otel.getMeter("lag"),
    logger : createOtelLoggerAdapter(otel.getLogger("lag")),
    events : createOtelEventSink(otel.getLogger("lag-events")),
    worker,
    workerHangReport : { url : "http://localhost:4318/v1/logs", resource : { "service.name" : "shop" } },
}));

// Record the pending values of the monitors before each export
otel.onBeforeFlush(() => monitors.flush());

// Later
monitors.stop();
worker.terminate();
```

`createBrowserDeps()` examines each browser API. Thus each browser gets the monitors that it can support. For example, Safari has no `requestIdleCallback`, so the idle monitor does not start there.

You can also use each monitor alone, as a class (`new DriftLag(...)`) or through its factory (`createInstrumentedDriftLag(deps, conditions)`). A factory gives a `MonitorHandle` with an error boundary and a `stop()`.

## Metrics

All durations are in milliseconds. All metrics are counters or histograms. The attributes have a small, fixed set of values. Details with many values (CSS selectors, URLs, IDs) go into the events. The table comes from the metric catalog (`packages/lag/src/metric-catalog.ts`): do not edit it here. Use `pnpm readme:metrics` to make it again.

<!-- metrics:start -->
| Monitor | Metric | Type | Unit | Attributes | Description |
| --- | --- | --- | --- | --- | --- |
| DriftLag | `lag_drift_histogram` | histogram | `ms` |  | The lag of one window (approximately 100 ms) of chained timeouts: its duration minus the idle duration of its steps. Each block of the main thread in the window adds to the lag. |
| DriftLag | `lag_drift_baseline_histogram` | histogram | `ms` |  | The idle duration of one timer step: the mean of the recent steps that are not blocks. An increase needs a probe that shows an idle thread. It is the timer granularity of the browser and the operating system. DriftLag subtracts it. |
| MacrotaskLag | `lag_macrotask_histogram` | histogram | `ms` |  | The time that a zero-delay timeout waits in the task queue. The monitor measures one sample every 5 seconds. |
| MeasurementConditions | `lag_samples_discarded` | counter | `{sample}` | `reason` | The number of samples that a monitor did not record because the measurement window was not valid. |
| MeasurementConditions | `lag_stalls` | counter | `{stall}` | `kind` | The number of stall episodes: very long samples (5000 ms or more) of all monitors whose windows overlap count as one episode. A hang has no evidence of a suspend. A suspend has evidence that the system stopped. |
| MeasurementConditions | `lag_stall_duration_histogram` | histogram | `ms` | `kind` | The duration of each stall episode: its longest sample. |
| WorkerLagMonitor | `lag_worker_main_block_histogram` | histogram | `ms` |  | The time that a worker heartbeat waited for the main thread. This is main-thread blocking, measured from outside the main thread. |
| WorkerLagMonitor | `lag_worker_self_lag_histogram` | histogram | `ms` |  | The lateness of the heartbeat timer of the worker. A high value shows that the worker itself did not operate. |
| WorkerLagMonitor | `lag_worker_clock_offset_histogram` | histogram | `ms` |  | The absolute offset between the worker clock and the main-thread clock, from the clock synchronization exchange. |
| WorkerLagMonitor | `lag_main_thread_hangs` | counter | `{hang}` | `outcome` | The number of main-thread hangs that the worker detected. In a hang, the main thread does not acknowledge heartbeats. The outcome `abandoned` means that the page closed or crashed during the hang. The next page of the origin reports it from the hang journal. Another open page of the origin, or the page itself at its close, can also report it (PeerHangWatch). |
| WorkerLagMonitor | `lag_main_thread_hang_duration_histogram` | histogram | `ms` | `outcome` | The duration of each main-thread hang. For an abandoned hang, the duration until the worker saw the hang for the last time. Without a record of the worker, it is the duration from the last heartbeat of the page to its end. |
| LongAnimationFrameMonitor | `lag_loaf_blocking_histogram` | histogram | `ms` |  | The blocking duration of each long animation frame. |
| LongAnimationFrameMonitor | `lag_loaf_duration_histogram` | histogram | `ms` |  | The total duration of each long animation frame. |
| EventTimingMonitor | `lag_event_duration_histogram` | histogram | `ms` | `interaction` | The duration of each interaction event of 16 ms or more, from input to the next paint. |
| EventTimingMonitor | `lag_event_input_delay_histogram` | histogram | `ms` | `interaction` | The time from the input to the start of the event handlers. |
| EventTimingMonitor | `lag_event_processing_histogram` | histogram | `ms` | `interaction` | The time that the event handlers used to process the event. |
| EventTimingMonitor | `lag_event_presentation_delay_histogram` | histogram | `ms` | `interaction` | The time from the end of the event handlers to the next paint. |
| LayoutShiftMonitor | `lag_layout_shift_histogram` | histogram | `1` |  | The score of each layout shift that did not follow user input. |
| PageViewVitals | `lag_web_vital_inp_histogram` | histogram | `ms` | `navigation_type` | Interaction to Next Paint (INP) for each page view. |
| PageViewVitals | `lag_web_vital_cls_histogram` | histogram | `1` | `navigation_type` | Cumulative Layout Shift (CLS) for each page view, in browsers that have layout-shift entries. |
| PageViewVitals | `lag_web_vital_lcp_histogram` | histogram | `ms` | `navigation_type` | Largest Contentful Paint (LCP) for each page view. |
| PageViewVitals | `lag_web_vital_fcp_histogram` | histogram | `ms` | `navigation_type` | First Contentful Paint (FCP) for each page view. |
| PageViewVitals | `lag_web_vital_ttfb_histogram` | histogram | `ms` | `navigation_type` | Time to First Byte (TTFB) for each page view. A restore from the back/forward cache and a soft navigation have no network response and get 0, as in web-vitals. A page without a navigation entry gets no value. |
| FrameTimingMonitor | `lag_frame_delta_histogram` | histogram | `ms` |  | The time between two animation frame callbacks. |
| FrameTimingMonitor | `lag_frames` | counter | `{frame}` | `outcome` | The number of delivered frames and the estimated number of dropped frames. |
| IdleAvailabilityMonitor | `lag_idle_time_remaining_histogram` | histogram | `ms` |  | The idle time that was available when an idle callback started. |
| IdleAvailabilityMonitor | `lag_idle_gap_histogram` | histogram | `ms` |  | The time between two idle callbacks. |
| IdleAvailabilityMonitor | `lag_idle_callbacks` | counter | `{callback}` | `timed_out` | The number of idle callbacks. A callback that timed out started because no idle period came before its timeout. |
| SchedulingFairnessMonitor | `lag_scheduling_microtask_histogram` | histogram | `ms` |  | The latency of a queueMicrotask callback. This value stays near 0 and is a baseline. |
| SchedulingFairnessMonitor | `lag_scheduling_macrotask_histogram` | histogram | `ms` |  | The latency of a zero-delay timeout. |
| SchedulingFairnessMonitor | `lag_scheduling_message_channel_histogram` | histogram | `ms` |  | The latency of a MessageChannel message. |
| MemoryMonitor | `lag_memory_used_bytes_histogram` | histogram | `By` | `source` | The used heap memory of each sample. |
| MemoryMonitor | `lag_memory_usage_ratio_histogram` | histogram | `1` |  | The used heap divided by the heap limit. Only the legacy source supplies the limit. |
| ComputePressureMonitor | `lag_pressure_state_histogram` | histogram | `1` | `source` | The compute pressure state of each record: 0 nominal, 1 fair, 2 serious, 3 critical. |
| GCSignalDetector | `lag_gc_events` | counter | `{gc}` |  | The number of garbage collections that the detector saw. |
| LifecycleStateMachine | `lag_lifecycle_transitions` | counter | `{transition}` | `from`, `to`, `trigger` | The number of page lifecycle transitions. A restore from the back/forward cache always counts, with the trigger pageshow, also when the state does not change (Chromium makes the page visible before pageshow). |
| TimerThrottleDetector | `lag_timer_calibrations` | counter | `{calibration}` | `throttled` | The number of timer calibration rounds. A throttled round shows that the browser slowed the timers. |
| ClockReliabilityChecker | `lag_clock_resolution_histogram` | histogram | `ms` |  | The resolution of performance.now(). The checker measures it one time for each page. |
| ClockDriftMonitor | `lag_clock_skew_histogram` | histogram | `ms` |  | The absolute difference between Date.now() and the absolute monotonic clock (timeOrigin from the start plus performance.now()). |
| ClockDriftMonitor | `lag_clock_jumps` | counter | `{jump}` | `direction`, `kind` | The number of discontinuities between the wall clock and the monotonic clock: a suspend (the monotonic clock stopped while the device slept) or a step of the system clock. |
| BrowserReportMonitor | `lag_browser_reports` | counter | `{report}` | `type` | The number of reports from the Reporting API, for example interventions and deprecations. |
| SharedLivenessMonitor | `lag_liveness_block_histogram` | histogram | `ms` |  | The duration of each main-thread block that a worker saw through shared memory. |
<!-- metrics:end -->

## Design rules

- **Calibrated probes.** A timer step takes longer than its requested delay, also on an idle page. DriftLag subtracts the idle step duration of its environment. On an idle page, the old probe reported 16 ms of lag for each 100 ms window in Chromium and 211 ms in Firefox and WebKit. The calibrated probe reports less than 0.5 ms.
- **Valid samples only.** Timer, frame and idle monitors pause while the page is hidden or frozen. A sample that overlaps a hidden, frozen or suspended interval is discarded and counted in `lag_samples_discarded`.
- **An outside observer.** A Web Worker sends heartbeats from its own timer. During a main-thread hang, the worker reports the hang itself.
- **No lost hangs.** A page that closes during a hang is reported as an abandoned hang. The report comes from the hang journal of the worker, from another open page of the origin, or from the page itself at its close. The last two ways also operate in WebKit and Safari, where a worker cannot write or send during a hang.
- **The page view as the unit.** Each event has the ID of its page view.
- **Low-cardinality attributes.** Each distinct set of attributes is a separate series. Measured values, timestamps and IDs are not attributes.
- **Full teardown.** `stop()` releases each timer, listener, observer and worker loop. The tests make sure that no timer or listener stays.
- **No globals in the core.** Only `createBrowserDeps()` reads the browser globals. All other parts get their dependencies as arguments, so that the unit tests can use fake time.

## Development

```sh
pnpm install
pnpm build              # tsc -b
pnpm typecheck          # build, then type-check the tests
pnpm test               # unit tests (fake timers)
pnpm test:browser       # browser tests in all engines, without Docker
pnpm lint:ste           # the writing rules of the README, the site and the TSDoc comments
```

`pnpm lint:ste` starts [`@mark1russell7/ste-lint`](https://github.com/mark1russell7/ste-lint), a linter for the writing rules of ASD-STE100 Simplified Technical English. It has its own repository, because other repositories use it too.

To add a package, use `pnpm new --name <name> --config <config>`. Do not write `package.json` files yourself.

The Grafana stack (Alloy, Mimir, Loki, Tempo and Grafana) is in [grafana-infra](https://github.com/mark1russell7/grafana-infra). The OpenTelemetry setup is in [otel-ts](https://github.com/mark1russell7/otel-ts).

[Tests](#tests) lists each test kind and its script.

## Tests

Vitest operates all tests. The browser tests use Playwright. Install the Playwright browsers before the first browser test:

```sh
pnpm --filter @lag/integration-tests exec playwright install chromium firefox webkit
```

| Test kind | Script | What the tests examine |
| --- | --- | --- |
| Unit tests | `pnpm test` | The logic of each monitor in Node, with fake timers. These tests also cover `@lag/load`, `@lag/report` and `@lag/scripts`. |
| Coverage | `pnpm coverage` | The unit-test coverage of `@lag/core`. The script writes `packages/lag/coverage/coverage-summary.json`. It fails below the thresholds. |
| Mutation tests | `pnpm mutation` | Stryker changes the code of `@lag/core` and starts the unit tests again. A change that no test finds is a surviving mutant. |
| Browser tests | `pnpm test:browser` | The monitors in Chromium, Firefox, WebKit and Chrome. The script also starts the CDP tests, the back/forward cache tests and the cross-origin-isolated tests. |
| Chromium tests | `pnpm test:chromium` | The browser tests in Chromium only. This script is the fast check. |
| CDP tests | `pnpm --filter @lag/integration-tests test:cdp` | Frozen pages, hidden pages, CPU throttling and compute pressure, through the Chrome DevTools Protocol. |
| Back/forward cache tests | `pnpm --filter @lag/integration-tests test:bfcache` | A page with the library stays in the back/forward cache of Chromium while another page of the origin sends messages. |
| Cross-origin-isolated tests | `pnpm --filter @lag/integration-tests test:coi` | Shared memory, the fine clock and `measureUserAgentSpecificMemory()` on a cross-origin-isolated page. |
| Overhead benchmark | `pnpm test:overhead` | The main-thread CPU time and the callbacks of all monitors on an idle page, against their budgets. |
| Soak test | `pnpm test:soak` | All monitors for 3 minutes under a mixed workload. The heap must not grow without limit. `stop()` must release each timer. |
| Safari tests | `pnpm --filter @lag/integration-tests test:safari` | The browser tests in the real Safari, through safaridriver. Only on macOS: enable it one time with `sudo safaridriver --enable`. |
| iOS tests | `pnpm --filter @lag/integration-tests test:ios` | The browser tests in Safari on iOS, in the iOS Simulator. Only on macOS with Xcode: boot a simulator, and set `LAG_IOS_UDID` to its UDID. |
| E2E tests | `pnpm test:e2e` | The export to the Grafana stack. The script starts the stack with Docker Compose. |
| Test results | `pnpm results` | All test kinds, without the soak test and the E2E tests. The results go to the site. |

A test that needs an API of one engine skips itself in the other engines. The test report shows the reason.

To change the duration of the soak test, set `LAG_SOAK_MS` to a value in milliseconds. This example sets 10 minutes in PowerShell:

```powershell
$env:LAG_SOAK_MS = 600000; pnpm test:soak
```

In Bash, put the variable before the command:

```sh
LAG_SOAK_MS=600000 pnpm test:soak
```

To show the test results on the site, do these steps:

1. Use `pnpm results`.
2. Use `pnpm --filter @lag/site dev`.
3. Open the Results page.

`pnpm results` writes the results to `packages/site/public/data/results/`. Git ignores this folder. The script includes the latest Stryker report if it exists.

To include the soak test, the E2E tests, Safari or Safari on iOS (on macOS), add `--soak`, `--e2e`, `--safari` or `--ios` to `pnpm results`.

GitHub Actions starts the build, the unit tests, the coverage, the browser tests and the site checks for each push and pull request (`ci.yml`). `e2e.yml` and `mutation.yml` start each week. You can also start them manually.

## AI-assisted text

An AI model (Claude, from Anthropic) wrote most of the text and the code of this repository, under the direction of the author. The tests, the mutation tests and the STE linter examine them. The STEMG of ASD-STE100 asks for this disclosure in its white paper on STE and artificial intelligence (June 2026).

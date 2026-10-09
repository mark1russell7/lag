# @mark1russell7/lag

[![npm](https://img.shields.io/npm/v/@mark1russell7/lag)](https://www.npmjs.com/package/@mark1russell7/lag)
[![CI](https://github.com/mark1russell7/lag/actions/workflows/ci.yml/badge.svg)](https://github.com/mark1russell7/lag/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@mark1russell7/lag)](https://github.com/mark1russell7/lag/blob/main/packages/lag/LICENSE)

`@mark1russell7/lag` measures the lag of the main thread in browser apps, on the devices of real users. It sends the results as OpenTelemetry metrics, events and spans.

The website has the documentation, a live playground, the thesis and the test results: <https://mark1russell7.github.io/lag/>.

## What the monitors measure

- **Blocked time.** DriftLag measures how much of each 100 ms the main thread was busy.
- **Hangs.** A Web Worker sends heartbeats. When the main thread does not acknowledge them, the worker reports the hang itself.
- **Long animation frames.** The monitor finds the script that blocked a frame (Chromium only).
- **Interactions.** Event Timing gives the input delay, the processing time and the presentation delay of each interaction.
- **Core Web Vitals.** The monitors give INP, CLS, LCP, FCP and TTFB for each page view, also after a restore from the back/forward cache.
- **The device and the clocks.** Other monitors measure the frames, the idle time, the memory, the compute pressure, the garbage collections, the timer throttling and the clock jumps.

`setupAllMonitors()` starts each monitor that the browser can support. The [monitor overview](https://mark1russell7.github.io/lag/docs/monitors) lists each monitor with its browser support and its cost.

## Why this library

- **Calibrated probes.** A timer step takes longer than its delay, also on an idle page. DriftLag subtracts the idle step duration of its browser and operating system.
- **Valid samples only.** The monitors discard each sample that a hidden page, a frozen page or a system suspend makes incorrect.
- **No lost hangs.** When a page closes during a hang, the next page of the origin reports the hang from the hang journal of the worker. Another open page of the origin can also report it.
- **Low cardinality.** All metrics are counters or histograms with a small, fixed set of attribute values. The details go into the events.
- **Full teardown.** `stop()` releases each timer, listener and observer.

## Install

```sh
npm install @mark1russell7/lag
```

The package is an ES module with TypeScript types. Its only dependency is [`page-lifecycle-tracker`](https://www.npmjs.com/package/page-lifecycle-tracker).

The worker monitors need a bundler that supports module workers (`new Worker(new URL("./file.js", import.meta.url), { type: "module" })`), for example Vite, webpack 5, or Rollup with a worker plugin. The bundler makes a separate file for the worker.

### Vite

In the Vite dev server, exclude the worker export from the dependency optimization. Without this setting, the dev server cannot find the file of the worker. `vite build` needs no setting.

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
    optimizeDeps : {
        exclude : ["@mark1russell7/lag/worker"],
    },
});
```

## Quick start

This example uses the OpenTelemetry SDK for JavaScript. Each OpenTelemetry `Meter` works.

```sh
npm install @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http @opentelemetry/resources
```

```ts
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { createBrowserDeps, setupAllMonitors } from "@mark1russell7/lag";
import { createLagWorker } from "@mark1russell7/lag/worker";

const provider = new MeterProvider({
    resource : resourceFromAttributes({ "service.name" : "shop", "service.instance.id" : crypto.randomUUID() }),
    readers : [new PeriodicExportingMetricReader({ exporter : new OTLPMetricExporter({ url : "https://collector.example.com/v1/metrics" }) })],
});

const worker = createLagWorker();
const monitors = setupAllMonitors(createBrowserDeps(window, { meter : provider.getMeter("lag"), logger : console, worker }));

// When the page becomes hidden: record the final values of the page view, then send them
document.addEventListener("visibilitychange", (event) => {
    if (document.visibilityState !== "hidden") return;
    monitors.flush(event);
    void provider.forceFlush();
});
```

The code does these steps:

1. It makes a `MeterProvider` with a new `service.instance.id` for each page load. Thus each browser writes its own series.
2. `createLagWorker()` starts the Web Worker of the worker-lag monitor.
3. `createBrowserDeps(window, options)` finds the browser APIs. `setupAllMonitors()` starts the monitors.
4. When the page becomes hidden, `monitors.flush(event)` records the final values of the page view before the last export.

To stop the monitors, use `monitors.stop()`, then `worker.terminate()`. The worker is yours: the monitors do not stop it.

For the events, the spans and the hang reports of the worker, refer to the [quick start](https://mark1russell7.github.io/lag/docs/getting-started) on the website. The [OpenTelemetry setup](https://mark1russell7.github.io/lag/docs/operations/opentelemetry) gives the SDK settings for the metrics of many browsers, for example exponential histograms.

## Exports

| Export | What it contains |
|---|---|
| `@mark1russell7/lag` | The monitors, `setupAllMonitors()`, `createBrowserDeps()`, the catalogs of the metrics, events and spans, and the OpenTelemetry adapters. The module reads no browser global when it loads. |
| `@mark1russell7/lag/worker` | `createLagWorker()` and the worker module that it starts. |
| `@mark1russell7/lag/event-line.js` | `formatEventLine()`, which makes the body line of each event record. |

The [API reference](https://mark1russell7.github.io/lag/docs/api) lists each export.

## Documentation

- [Quick start](https://mark1russell7.github.io/lag/docs/getting-started)
- [Monitors](https://mark1russell7.github.io/lag/docs/monitors)
- [Measurement validity](https://mark1russell7.github.io/lag/docs/concepts/measurement-validity)
- [OpenTelemetry setup](https://mark1russell7.github.io/lag/docs/operations/opentelemetry)
- [API reference](https://mark1russell7.github.io/lag/docs/api)
- [Playground](https://mark1russell7.github.io/lag/playground): the monitors in your browser, with synthetic load

## License

MIT

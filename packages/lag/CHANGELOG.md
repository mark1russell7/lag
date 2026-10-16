# Changelog

## Unreleased

### Fixed

- **DriftLag with throttled timers on a visible page.** Safari makes the nested timers of a page that it does not show ("visually idle") wait for a grid of 1 s, while `visibilityState` stays "visible" (WebKit `Page::updateTimerThrottlingState`). DriftLag recorded each step of 1 s as lag. A GitHub macOS runner was in this state. Now, with `postTask`, DriftLag finds throttled timers: a step of 500 ms or more, after a long step, with a thread that was idle during more than half of a probe of 50 ms. Then it logs "DriftLag: the browser throttles the timers. The windows pause." and it records no windows. A shorter step, or a probe each 30 throttled steps that finds a busy thread, ends the throttling. A single block starts no probe. The metric names do not change.

### Changed

- **The probes of DriftLag operate for 50 ms or less.** `BusyTimeProbe.start(limitMs)` stops the chain of messages after that time. A message that waits at the limit still counts its full wait. A probe of a step of 40 ms or less examines all of the step, as before.
- **The window waits for one more step after a long step.** A window does not end at the first step of more than 40 ms of a row. Thus a throttled step cannot end a window before the check.

## 0.2.2

### Fixed

- **DriftLag in a frame off the screen.** In a frame (an iframe) that is fully off the screen, WebKit makes the nested timers wait approximately 1 s. Safari on macOS and iOS has this rule, also for a frame of the same origin. The `visibilityState` of the frame stays `visible`, thus DriftLag did not pause, and it recorded the wait as lag: 2473 ms in one window of a browser test. Now DriftLag pauses while its frame is off the screen, as the frame-timing monitor does (`pauseWhileHidden(monitor, { offscreen: true })`). Chromium and Firefox do not slow these timers, thus there DriftLag records no samples while the frame is off the screen. MacrotaskLag does not pause: it starts its timeout in a message task, where WebKit does not slow the timeout.
- **`createBrowserDeps()` gives `frameViewport` also without animation frames.** DriftLag uses it now. The frame viewport makes its `IntersectionObserver` only at the first subscription.

## 0.2.1

### Fixed

- **Prerendered pages.** A prerender that the user did not see sent a `lag.page_view.start` event, and at its unload a `lag.page_view` span. The page view of a prerendered page now starts at the activation, as its vitals do: the start event and the span come at the activation. The worker gets the identity of the span at that time too.
- **Observer monitors after a restart.** After `stop()` and `start()`, `LongAnimationFrameMonitor`, `EventTimingMonitor` and `LayoutShiftMonitor` reported each earlier entry again, because the new observer asked for the buffer of the browser. The histograms counted these entries two times. Now only an observer before the first entries asks for the buffer, as in `BrowserReportMonitor`. `stop()` keeps the INP and the CLS. The monitors do not get the entries during a stop.
- **MemoryMonitor after a restart.** A `stop()` and a `start()` during a sample of `measureUserAgentSpecificMemory()` gave that sample to the new run, and the new run took no first sample of its own. Now the monitor drops the sample of the earlier run. When it ends, the new run takes its first sample at once. The samples still do not overlap.
- **ComputePressureMonitor with a source that throws.** When `observe()` threw an error for one source at once, the monitor did not observe the other sources. It also logged "PressureObserver not available in this browser." Now it logs the warning of that source and observes the other sources.
- **The hang journal reader.** When the take or the report of one record failed, the reader stopped: it did not report the other abandoned hangs, and it did not remove the old marks. Now it logs "Could not take a record of the hang journal." with the page ID and continues.

### Changed

- **TimerThrottleDetector: a block is not throttling.** With `MessageChannel`, each sample also posts a message task as a control. A block of the main thread delays the timer and the message task. Throttling delays only the timer. Thus a sample counts as throttled only when its timer waits more than the threshold longer than its message task. The report of a round has the new field `blockedSamples`. `setupAllMonitors()` gives the control. Without `MessageChannel`, the detector operates as before. The metric `lag_timer_calibrations` does not change.
- **FrameTimingMonitor: a pause while its frame is off the screen.** In an iframe off the screen, `visibilityState` stays `visible`, but the browser stops or slows the animation frames (experiment E9). Then the monitor recorded long frame gaps that were not lag. Now `createBrowserDeps()` gives `frameViewport` to a document in a frame: an `IntersectionObserver` on its `documentElement`. The frame-timing monitor of `setupAllMonitors()` pauses while the frame is off the screen. The new parts of the API are `pauseWhileHidden(monitor, { offscreen: true })`, the option `viewport` of `createMeasurementConditions()`, `createFrameViewport()` and `ViewportDeps`.

## 0.2.0

### New

- **The add-on `@mark1russell7/lag/async-context`.** It finds the long callbacks: the callbacks of 50 ms or more, with the hook of [async-browser-context](https://www.npmjs.com/package/async-browser-context) 0.2.2 or later (an optional peer dependency). Each long callback gives the name of the function, its source (for example `setTimeout` or `addEventListener:click`), a closed source kind and the operation. The add-on records the histogram `lag_long_callback_duration_histogram`, the event `lag.long_callback` and the span `lag.long_callback`. Thus Firefox and Safari also get an attribution of the lag, and Chromium gets the function names back when async-browser-context wraps the callbacks. Refer to the page [long callbacks](https://mark1russell7.github.io/lag/docs/monitors/long-callbacks).
- **`AllMonitorHandles.add(factory)`.** It registers a monitor that the application adds, with the dependencies of the setup: the page-view context, the spans and the stop.

### Fixed

- **GCSignalDetector.** When `onGC` stopped and started the detector, the detector armed two canaries. After that, each garbage collection counted two times. The detector now arms a canary only when no canary is in flight.

### Tests

- The mutation score of the package is 98.1% (it was 95.9%). The tests examine 1165 cases.

## 0.1.0

The first version on npm.

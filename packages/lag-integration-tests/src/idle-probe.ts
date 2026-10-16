import { BusyTimeProbe, createMessageTaskQueue } from "@mark1russell7/lag";
import { wait } from "./harness.js";

/**
 * The probe of DriftLag operates only if one probe on an idle page posts this
 * number of messages in 100 ms, or more. Then it can confirm a baseline and
 * find throttled timers.
 *
 * In the WebKit build of Playwright for Windows, each message waits for a
 * timer of 0 ms of the system. There, the most messages of three probes were
 * 122 to 278 in 32 runs (9 October 2026). In Chromium and Firefox, they were
 * 9,681 to 34,180.
 *
 * In CI, the other WebKit builds post fewer messages, but they confirm a
 * baseline. WebKit for Linux posted 904 to 920, Safari on macOS 615 to 877,
 * and Safari on iOS 580 to 609. The limit is between the two groups.
 *
 * An earlier rule used the busy time of the probe. In WebKit for Windows,
 * that time changed from 0 ms to 87 ms with the load of the computer.
 */
export const MIN_IDLE_MESSAGES = 400;

/**
 * The probe on an idle page, three times for 100 ms: the most messages that
 * one probe posted, and the least busy time.
 */
export async function idleProbe() : Promise<{ messages : number; busyMs : number }> {
    let posted = 0;
    const queue = createMessageTaskQueue(MessageChannel);
    const probe = new BusyTimeProbe((callback) => {
        posted++;
        queue.post(callback);
    }, performance);
    const messages : number[] = [];
    const busyMs : number[] = [];
    for (let i = 0; i < 3; i++) {
        await wait(200);
        posted = 0;
        probe.start();
        await wait(100);
        busyMs.push(probe.stop());
        messages.push(posted);
    }
    queue.close();
    return { messages : Math.max(...messages), busyMs : Math.min(...busyMs) };
}

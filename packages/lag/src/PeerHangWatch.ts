import type { ClearIntervalFn, ClearTimeoutFn, Clock, Logger, SetIntervalFn, SetTimeoutFn, WallClock } from "./types.js";
import type { HangJournal, HangRecord } from "./hang-journal.js";

/** The name of the BroadcastChannel of the watch. */
export const PEER_CHANNEL_NAME = "lag-peer-hang-watch";

/** A visible page holds this Web Lock. The browser releases it when the page closes, also during a hang. */
export const peerLockName = (pageId : string) : string => `lag-page:${pageId}`;

/** The first page that reports the end of a page holds this lock. Thus no other page reports it again. */
const claimLockName = (pageId : string) : string => `lag-page-claim:${pageId}`;

/** The default interval of the heartbeats of a visible page. */
export const PEER_BEAT_INTERVAL_MS = 1_000;

/** The default silence before the end of a page that makes the end an abandoned hang. It is the hang threshold of the worker. */
export const PEER_HANG_THRESHOLD_MS = 5_000;

/**
 * After the lock of a page comes free, the watch waits this long for the
 * last messages of the page. The messages and the lock use different paths
 * through the browser, thus a message can arrive after the lock.
 */
export const PEER_GRACE_MS = 1_000;

/**
 * The page that reports a hang keeps the claim for this long. The other
 * pages that watch the hung page try the claim after their wait for the last
 * messages. Their lock grants and their timers can be late by some seconds,
 * thus this time is much longer than the wait.
 */
export const PEER_CLAIM_HOLD_MS = 60_000;

/**
 * The page that reports an abandoned hang: another page of the origin
 * (`peer`), or the hung page itself at its close (`self`).
 */
export type AbandonedHangSource = "peer" | "self";

/** A message of a page to the other pages of its origin. */
export type PeerMessage =
    /** The page is visible and its main thread operates. */
    | { type : "beat"; pageId : string; sentAt : number; attributes : Readonly<Record<string, string>> }
    /** The page becomes hidden or closes. Then it releases its lock. */
    | { type : "away"; pageId : string; sentAt : number };

/** The part of `BroadcastChannel` that the watch uses. */
export type BroadcastChannelLike = {
    postMessage(message : unknown) : void;
    onmessage : ((event : { readonly data : unknown }) => void) | null;
    close() : void;
};

export type BroadcastChannelConstructor = new (name : string) => BroadcastChannelLike;

/**
 * The part of the Web Locks API (`navigator.locks`) that the watch uses. The
 * callback gets `null` when `ifAvailable` is true and another holder has the
 * lock. The holder keeps the lock until the promise of the callback settles.
 */
export type LockManagerLike = {
    request(name : string, options : { ifAvailable? : boolean }, callback : (lock : unknown) => unknown) : Promise<unknown>;
};

export type PeerHangWatchDeps = {
    BroadcastChannel : BroadcastChannelConstructor;
    locks : LockManagerLike;
    /** The wall clock: the pages of an origin compare their times with it. */
    wallClock : WallClock;
    /** The monotonic clock of the page, for the time between its own heartbeats. */
    clock : Clock;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
    logger : Logger;
};

export type PeerHangWatchOptions = {
    /** The ID of this page instance. The hang journal of the worker uses the same ID. */
    pageId : string;
    /** True when the page is visible at the start. */
    visible : boolean;
    beatIntervalMs? : number;
    thresholdMs? : number;
    graceMs? : number;
    /**
     * The hang journal. The worker of a page that hangs writes its record
     * there, except in WebKit. The page that reports the hang takes the
     * record, thus the next page does not report it again.
     */
    journal? : HangJournal;
    /** The watch uses this function for each page that closed during a hang, also for its own page. */
    onAbandonedHang : (hang : HangRecord, source : AbandonedHangSource) => void;
};

type Peer = {
    /** The wall-clock time of the last heartbeat of the page. */
    lastBeatAt : number;
    /** The page said that it became hidden or closes. */
    away : boolean;
    attributes : Readonly<Record<string, string>>;
};

function isStringRecord(value : unknown) : value is Record<string, string> {
    return typeof value === "object" && value !== null && Object.values(value).every(v => typeof v === "string");
}

/** True for a message of the watch. Other code of the origin can use a channel of the same name. */
export function isPeerMessage(value : unknown) : value is PeerMessage {
    const message = value as Partial<Record<keyof PeerMessage | "attributes", unknown>> | null;
    if (typeof message !== "object" || message === null) return false;
    if (typeof message.pageId !== "string" || !Number.isFinite(message.sentAt)) return false;
    if (message.type === "away") return true;
    return message.type === "beat" && isStringRecord(message.attributes);
}

/**
 * The open pages of an origin watch each other for hangs.
 *
 * A worker cannot keep the record of a hang in WebKit and Safari, because
 * their workers write and send only through the main thread (experiments E4
 * and E6). Another page of the origin has its own main thread. Thus it can
 * see the hang and the end of the page (experiment E7):
 *
 * - A visible page holds a Web Lock and sends a heartbeat each second
 *   through a BroadcastChannel. When it becomes hidden or closes, it says
 *   so and releases its lock.
 * - Each other page asks for the lock of each page that it sees. The browser
 *   gives the lock when the page closes or becomes hidden. A hung page keeps
 *   its lock until the browser stops it.
 * - The lock can come free when the page did not say "away", and its last
 *   heartbeat is `thresholdMs` old or older. Then the page closed during a
 *   hang. One page reports it: the first page that gets the claim lock.
 *
 * The watch needs a second visible or hidden page of the origin. A hidden
 * page does not send heartbeats, but it watches the others. It holds no lock,
 * except a claim for `PEER_CLAIM_HOLD_MS` after it reports a hang.
 *
 * Firefox and Safari on macOS do not stop a hung page that the user closes.
 * Firefox stops the blocked script, and Safari lets the script continue
 * until it ends. Then the page closes normally. Thus the page itself can report the
 * hang at its close (`hide(true)`). Its heartbeats show the hang: no
 * heartbeat for `thresholdMs` or more before the close, or a heartbeat after
 * such a gap immediately before the close. The page does not report a hang
 * that its worker monitor counted already (`noteHangEnded()`).
 *
 * A page in the back/forward cache must not get messages: Chrome removes a
 * page from the cache when a BroadcastChannel message arrives for it. Thus
 * the page closes its channel when it goes into the cache or the browser
 * freezes it (`suspend()`), and opens it again after that (`resume()`).
 */
export class PeerHangWatch {
    /** The channel to the other pages. It is closed while the page is in the back/forward cache or frozen. */
    private channel : BroadcastChannelLike | undefined;
    private readonly peers = new Map<string, Peer>();
    private readonly graceTimers = new Set<number>();
    private readonly beatIntervalMs : number;
    private readonly thresholdMs : number;
    private readonly graceMs : number;
    private attributes : Readonly<Record<string, string>> = {};
    /** The current request of the own lock. The watch does not use the grant of an earlier request. */
    private ownRequest : object | undefined;
    private stopBeats : (() => void) | undefined;
    private releaseOwnLock : (() => void) | undefined;
    /** The monotonic time of the last own heartbeat in this visible period, and the gap before it. */
    private lastBeat : number | undefined;
    private lastGapMs = 0;
    /** The monotonic time at which the worker monitor of this page counted the end of a hang. */
    private hangEndedAt : number | undefined;
    private stopped = false;
    /** The page is in the back/forward cache, or the browser froze it. */
    private suspended = false;
    /** The functions that release the claims that the page holds. */
    private readonly claimReleases = new Set<() => void>();

    constructor(private readonly deps : PeerHangWatchDeps, private readonly options : PeerHangWatchOptions) {
        this.beatIntervalMs = options.beatIntervalMs ?? PEER_BEAT_INTERVAL_MS;
        this.thresholdMs = options.thresholdMs ?? PEER_HANG_THRESHOLD_MS;
        this.graceMs = options.graceMs ?? PEER_GRACE_MS;
        this.channel = this.openChannel();
        if (options.visible) this.show();
    }

    /** This method sets the context that the heartbeats carry, for example `lag.page_view.id`. */
    setContext(attributes : Record<string, string>) : void {
        this.attributes = { ...attributes };
    }

    /** The page became visible: it takes its lock, and then sends heartbeats. */
    show() : void {
        if (this.stopped || this.ownRequest) return;
        const request = {};
        this.ownRequest = request;
        this.request(peerLockName(this.options.pageId), {}, () => {
            if (this.ownRequest !== request) return undefined;
            this.beat();
            const timer = this.deps.setIntervalFn(() => this.beat(), this.beatIntervalMs);
            this.stopBeats = () => this.deps.clearIntervalFn(timer);
            return new Promise<void>((resolve) => { this.releaseOwnLock = resolve; });
        });
    }

    /**
     * The page becomes hidden or closes: it says so first, and then it
     * releases its lock. With `closing`, the page closes (`pagehide` without
     * the back/forward cache). Then it reports its own hang, if it closes at
     * the end of a hang.
     */
    hide(closing = false) : void {
        if (this.stopped || !this.ownRequest) return;
        if (closing) this.reportOwnHang();
        this.ownRequest = undefined;
        this.lastBeat = undefined;
        this.lastGapMs = 0;
        this.stopBeats?.();
        this.stopBeats = undefined;
        this.post({ type : "away", pageId : this.options.pageId, sentAt : this.deps.wallClock.now() });
        this.releaseOwnLock?.();
        this.releaseOwnLock = undefined;
    }

    /** The worker monitor of this page counted the end of a hang. Thus the page does not report that hang at its close. */
    noteHangEnded() : void {
        this.hangEndedAt = this.deps.clock.now();
    }

    /**
     * The page goes into the back/forward cache, or the browser freezes it.
     * The page says "away", releases its locks and closes its channel.
     */
    suspend() : void {
        this.hide();
        this.suspended = true;
        this.closeChannel();
        // Without the channel, the page misses the "away" of the other pages. Thus it forgets them:
        // a page that closes normally in this time must not look like a page that closed during a hang.
        this.peers.clear();
        // Chromium does not keep a page that holds a lock in the back/forward cache
        this.releaseClaims();
    }

    /** The page operates again after a freeze or a restore from the back/forward cache: it opens its channel again. */
    resume() : void {
        if (this.stopped) return;
        this.suspended = false;
        if (this.channel) return;
        try {
            this.channel = this.openChannel();
        } catch (error) {
            this.deps.logger.log("debug", "Could not open the channel to the other pages.", { error, type : "PeerHangWatch" });
        }
    }

    /** This method stops the watch. The page says "away", and releases its locks. */
    stop() : void {
        this.hide();
        this.stopped = true;
        this.releaseClaims();
        for (const timer of this.graceTimers) this.deps.clearTimeoutFn(timer);
        this.closeChannel();
    }

    private openChannel() : BroadcastChannelLike {
        const channel = new this.deps.BroadcastChannel(PEER_CHANNEL_NAME);
        channel.onmessage = (event) => this.receive(event.data);
        return channel;
    }

    private closeChannel() : void {
        if (!this.channel) return;
        this.channel.onmessage = null;
        this.channel.close();
        this.channel = undefined;
    }

    private beat() : void {
        const now = this.deps.clock.now();
        this.lastGapMs = this.lastBeat === undefined ? 0 : now - this.lastBeat;
        this.lastBeat = now;
        this.post({ type : "beat", pageId : this.options.pageId, sentAt : this.deps.wallClock.now(), attributes : this.attributes });
    }

    /**
     * The page closes. If its main thread did not operate for `thresholdMs`
     * or more until the close, the page closed at the end of a hang. A
     * heartbeat can come between the hang and the close, because the timer
     * of the heartbeats was due during the hang.
     */
    private reportOwnHang() : void {
        if (this.lastBeat === undefined) return;
        const now = this.deps.clock.now();
        const sinceLastBeat = now - this.lastBeat;
        let hangStart : number | undefined;
        if (sinceLastBeat >= this.thresholdMs) hangStart = this.lastBeat;
        else if (this.lastGapMs >= this.thresholdMs && sinceLastBeat < this.beatIntervalMs) hangStart = this.lastBeat - this.lastGapMs;
        if (hangStart === undefined) return;
        // The worker monitor counted this hang as ended
        if ((this.hangEndedAt ?? Number.NEGATIVE_INFINITY) >= hangStart) return;
        const wallNow = this.deps.wallClock.now();
        this.options.onAbandonedHang({
            pageId : this.options.pageId,
            startedAt : wallNow - (now - hangStart),
            lastSeenAt : wallNow,
            attributes : this.attributes,
        }, "self");
    }

    private post(message : PeerMessage) : void {
        if (!this.channel) return;
        try {
            this.channel.postMessage(message);
        } catch (error) {
            this.deps.logger.log("debug", "Could not send a message to the other pages.", { error, type : "PeerHangWatch" });
        }
    }

    /** A lock request that fails (for example in an opaque origin) stops only that request. */
    private request(name : string, options : { ifAvailable? : boolean }, callback : (lock : unknown) => unknown) : void {
        try {
            this.deps.locks.request(name, options, callback).catch((error : unknown) => {
                this.deps.logger.log("debug", "A Web Lock request failed.", { error, name, type : "PeerHangWatch" });
            });
        } catch (error) {
            this.deps.logger.log("debug", "A Web Lock request failed.", { error, name, type : "PeerHangWatch" });
        }
    }

    private receive(data : unknown) : void {
        if (this.stopped || !isPeerMessage(data) || data.pageId === this.options.pageId) return;
        const known = this.peers.get(data.pageId);
        if (data.type === "away") {
            if (known) known.away = true;
            return;
        }
        if (known) {
            known.lastBeatAt = Math.max(known.lastBeatAt, data.sentAt);
            known.away = false;
            known.attributes = data.attributes;
            return;
        }
        const peer : Peer = { lastBeatAt : data.sentAt, away : false, attributes : data.attributes };
        this.peers.set(data.pageId, peer);
        // The browser gives the lock when the page releases it: when it becomes hidden, closes or stops
        this.request(peerLockName(data.pageId), {}, () => {
            if (!this.stopped) this.peerEnded(data.pageId, peer);
        });
    }

    private peerEnded(pageId : string, peer : Peer) : void {
        // The lock of a page that the watch forgot (refer to `suspend()`)
        if (this.peers.get(pageId) !== peer) return;
        const endedAt = this.deps.wallClock.now();
        const timer = this.deps.setTimeoutFn(() => {
            this.graceTimers.delete(timer);
            // A later heartbeat of the page makes a new entry and a new lock request
            this.peers.delete(pageId);
            if (peer.away || endedAt - peer.lastBeatAt < this.thresholdMs) return;
            this.claim(pageId, peer, endedAt);
        }, this.graceMs);
        this.graceTimers.add(timer);
    }

    private claim(pageId : string, peer : Peer, endedAt : number) : void {
        this.request(claimLockName(pageId), { ifAvailable : true }, async (lock) => {
            if (lock === null || this.stopped) return;
            // The record of the worker of the page, if the worker could write it
            const journal = this.options.journal;
            const record = await journal?.take(pageId, Number.POSITIVE_INFINITY).catch(() => undefined);
            if (this.stopped) {
                // Keep the record for the next page
                if (journal && record) await journal.put(record).catch(() => {});
                return;
            }
            this.options.onAbandonedHang(record ?? { pageId, startedAt : peer.lastBeatAt, lastSeenAt : endedAt, attributes : peer.attributes }, "peer");
            // No other page may report the same hang. Thus this page keeps the claim for a time.
            await this.holdClaim();
        });
    }

    /** The page keeps a claim for `PEER_CLAIM_HOLD_MS`, or until it is suspended or stops. */
    private holdClaim() : Promise<void> {
        if (this.stopped || this.suspended) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const release = () : void => {
                this.deps.clearTimeoutFn(timer);
                this.claimReleases.delete(release);
                resolve();
            };
            const timer = this.deps.setTimeoutFn(release, PEER_CLAIM_HOLD_MS);
            this.claimReleases.add(release);
        });
    }

    private releaseClaims() : void {
        for (const release of [...this.claimReleases]) release();
    }
}

import type {
    EventAttributes,
    EventSink,
    MonitorRecorder,
    OpenSpan,
    RecordedFrame,
    RecordedInteractionEvent,
    RecordedLayoutShift,
    SpanIdentity,
    SpanOptions,
    SpanSink,
} from "../../adapters/lag-core";
import { RingBuffer } from "../ring-buffer";

/** One event of the monitors. The time is a time of the session clock, in ms. */
export type RecordedEvent = {
    readonly name : string;
    readonly time : number;
    readonly attributes : EventAttributes;
};

/** One span of the monitors. The times are times of the session clock, in ms. */
export type RecordedSpan = {
    readonly id : string;
    readonly parentId : string | undefined;
    readonly name : string;
    readonly start : number;
    /** The value is undefined while the span is open. */
    readonly end : number | undefined;
    readonly attributes : EventAttributes;
};

/** What the recorder kept, oldest first. All times are times of the session clock, in ms. */
export type RecorderContents = {
    readonly events : readonly RecordedEvent[];
    readonly spans : readonly RecordedSpan[];
    readonly frames : readonly RecordedFrame[];
    readonly interactions : readonly RecordedInteractionEvent[];
    readonly shifts : readonly RecordedLayoutShift[];
};

export type RecorderCapacity = {
    events : number;
    spans : number;
    frames : number;
    interactions : number;
    shifts : number;
};

export type SessionRecorderOptions = {
    /**
     * The Unix time (ms) of the time 0 of the session clock, for example
     * `performance.timeOrigin`. The monitors give the times of events and
     * spans in Unix milliseconds. The recorder subtracts the origin.
     */
    origin : number;
    /** The session clock, in ms. An event without a time gets the time of the call. */
    now : () => number;
    capacity? : Partial<RecorderCapacity>;
};

const DEFAULT_CAPACITY : RecorderCapacity = {
    events : 4_000,
    spans : 2_000,
    frames : 4_000,
    interactions : 4_000,
    shifts : 1_000,
};

type MutableSpan = {
    id : string;
    parentId : string | undefined;
    name : string;
    start : number;
    end : number | undefined;
    attributes : EventAttributes;
};

function hexId(value : number, length : number) : string {
    return value.toString(16).padStart(length, "0");
}

/**
 * The recorder of the playground session. It is the event sink and the span
 * sink of the monitors, and it keeps the entries of the probes. It keeps the
 * newest items of each kind in a ring buffer. It has no React and no
 * browser code.
 */
export class SessionRecorder implements MonitorRecorder {
    readonly events : EventSink;
    readonly spans : SpanSink;
    private readonly eventBuffer : RingBuffer<RecordedEvent>;
    private readonly spanBuffer : RingBuffer<MutableSpan>;
    private readonly frameBuffer : RingBuffer<RecordedFrame>;
    private readonly interactionBuffer : RingBuffer<RecordedInteractionEvent>;
    private readonly shiftBuffer : RingBuffer<RecordedLayoutShift>;
    private nextId = 1;

    constructor(private readonly options : SessionRecorderOptions) {
        const capacity = { ...DEFAULT_CAPACITY, ...options.capacity };
        this.eventBuffer = new RingBuffer(capacity.events);
        this.spanBuffer = new RingBuffer(capacity.spans);
        this.frameBuffer = new RingBuffer(capacity.frames);
        this.interactionBuffer = new RingBuffer(capacity.interactions);
        this.shiftBuffer = new RingBuffer(capacity.shifts);
        this.events = {
            emit : (name, attributes, eventOptions) => {
                const time = eventOptions?.time;
                this.eventBuffer.push({
                    name,
                    time : time !== undefined && Number.isFinite(time) ? this.toClock(time) : options.now(),
                    attributes : { ...attributes },
                });
            },
        };
        this.spans = {
            start : (name, spanOptions) => this.startSpan(name, spanOptions),
            record : (name, spanOptions) => { this.pushSpan(name, spanOptions, spanOptions.endTime); },
        };
    }

    longAnimationFrame(frame : RecordedFrame) : void {
        this.frameBuffer.push(frame);
    }

    interaction(event : RecordedInteractionEvent) : void {
        this.interactionBuffer.push(event);
    }

    layoutShift(shift : RecordedLayoutShift) : void {
        this.shiftBuffer.push(shift);
    }

    /** A copy of what the recorder kept. A later record does not change it. */
    contents() : RecorderContents {
        return {
            events : this.eventBuffer.toArray(),
            spans : this.spanBuffer.toArray().map(span => ({ ...span, attributes : { ...span.attributes } })),
            frames : this.frameBuffer.toArray(),
            interactions : this.interactionBuffer.toArray(),
            shifts : this.shiftBuffer.toArray(),
        };
    }

    private toClock(unixMs : number) : number {
        return unixMs - this.options.origin;
    }

    private identity(parent : SpanIdentity | undefined) : SpanIdentity {
        const id = this.nextId++;
        return { traceId : parent?.traceId ?? hexId(id, 32), spanId : hexId(id, 16) };
    }

    private pushSpan(name : string, spanOptions : SpanOptions, endTime : number | undefined) : { span : MutableSpan; identity : SpanIdentity } {
        const identity = this.identity(spanOptions.parent);
        const span : MutableSpan = {
            id : identity.spanId,
            parentId : spanOptions.parent?.spanId,
            name,
            start : this.toClock(spanOptions.startTime),
            end : endTime === undefined ? undefined : this.toClock(endTime),
            attributes : { ...spanOptions.attributes },
        };
        this.spanBuffer.push(span);
        return { span, identity };
    }

    private startSpan(name : string, spanOptions : SpanOptions) : OpenSpan {
        const { span, identity } = this.pushSpan(name, spanOptions, undefined);
        return {
            identity,
            setAttributes : (attributes) => {
                if (span.end === undefined) span.attributes = { ...span.attributes, ...attributes };
            },
            end : (endTime) => {
                if (span.end === undefined) span.end = this.toClock(endTime);
            },
        };
    }
}

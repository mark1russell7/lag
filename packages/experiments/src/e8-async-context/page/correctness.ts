/**
 * The context check of measurement 4. Each case makes a span active, starts
 * asynchronous work, and examines the active span when the work continues.
 * The spans do not record, thus nothing goes to an exporter.
 */
import { context, trace, TraceFlags, type Span } from "@opentelemetry/api";
import { DATA_PATH, type CorrectnessResult } from "../shared/types.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
let nextSpanId = 1;

function newSpan() : Span {
    const spanId = (nextSpanId++).toString(16).padStart(16, "0");
    return trace.wrapSpanContext({ traceId : TRACE_ID, spanId, traceFlags : TraceFlags.SAMPLED });
}

function isActive(span : Span) : boolean {
    return trace.getActiveSpan()?.spanContext().spanId === span.spanContext().spanId;
}

/** This function starts `fn` with `span` as the active span. */
function inSpan<T>(span : Span, fn : () => T) : T {
    return context.with(trace.setSpan(context.active(), span), fn);
}

const dataUrl = () : string => new URL(DATA_PATH, document.baseURI).href;

async function syncCase() : Promise<boolean> {
    const span = newSpan();
    return inSpan(span, () => isActive(span));
}

async function promiseThen() : Promise<boolean> {
    const span = newSpan();
    return inSpan(span, () => Promise.resolve().then(() => isActive(span)));
}

async function afterAwait() : Promise<boolean> {
    const span = newSpan();
    return inSpan(span, async () => {
        await Promise.resolve();
        return isActive(span);
    });
}

async function setTimeoutCase() : Promise<boolean> {
    const span = newSpan();
    return inSpan(span, () => new Promise<boolean>(resolve => setTimeout(() => resolve(isActive(span)), 0)));
}

/** The listener is added in the span. The browser dispatches the event later: a message to a port. */
async function listenerBrowserDispatch() : Promise<boolean> {
    const span = newSpan();
    const channel = new MessageChannel();
    const result = new Promise<boolean>(resolve => {
        inSpan(span, () => {
            channel.port1.addEventListener("message", () => resolve(isActive(span)), { once : true });
            channel.port1.start();
        });
    });
    channel.port2.postMessage("e8");
    const kept = await result;
    channel.port1.close();
    return kept;
}

/**
 * The listener is added in the span. Code in the root context dispatches the
 * event. The rule C13 of async-browser-context: a listener gets the context of
 * the dispatch. For a dispatch in the root context, it gets the context of the
 * registration.
 */
async function listenerCodeDispatch() : Promise<boolean> {
    const span = newSpan();
    const target = new EventTarget();
    let kept = false;
    inSpan(span, () => target.addEventListener("e8", () => { kept = isActive(span); }, { once : true }));
    target.dispatchEvent(new Event("e8"));
    return kept;
}

async function fetchThen() : Promise<boolean> {
    const span = newSpan();
    return inSpan(span, () => fetch(dataUrl()).then(async (response) => {
        const kept = isActive(span);
        await response.text();
        return kept;
    }));
}

async function awaitFetch() : Promise<boolean> {
    const span = newSpan();
    return inSpan(span, async () => {
        const response = await fetch(dataUrl());
        await response.text();
        return isActive(span);
    });
}

/** No span stays active outside the cases: in this code, and in a new task. */
async function noLeak() : Promise<boolean> {
    const here = trace.getActiveSpan() === undefined;
    const inTask = await new Promise<boolean>(resolve => setTimeout(() => resolve(trace.getActiveSpan() === undefined), 0));
    return here && inTask;
}

/** This function examines each case, one after the other. */
export async function checkContext() : Promise<CorrectnessResult> {
    return {
        "sync" : await syncCase(),
        "promise-then" : await promiseThen(),
        "await" : await afterAwait(),
        "set-timeout" : await setTimeoutCase(),
        "listener-browser-dispatch" : await listenerBrowserDispatch(),
        "listener-code-dispatch" : await listenerCodeDispatch(),
        "fetch-then" : await fetchThen(),
        "await-fetch" : await awaitFetch(),
        "no-leak" : await noLeak(),
    };
}

import type { AttributeValue } from "./meter.js";

/** This function formats an attribute value for a line: in quotes when it has a space, a quote or "=". */
function lineValue(value : AttributeValue) : string {
    const text = String(value);
    return text === "" || /[\s="]/.test(text) ? JSON.stringify(text) : text;
}

/**
 * This function gives the line of an event: the event name and the
 * attributes, as sorted key=value pairs. The event sink and the worker use
 * it as the body of the log record. A log store can use the body as the
 * line. Loki drops an entry when the previous entry of its stream has the
 * same timestamp and the same line. A browser sends several events in one
 * millisecond, for example the five Web Vitals of one report. The attributes
 * make each line different.
 */
export function formatEventLine(name : string, attributes : Readonly<Record<string, AttributeValue>>) : string {
    const pairs = Object.keys(attributes).sort().map(key => `${key}=${lineValue(attributes[key]!)}`);
    return [name, ...pairs].join(" ");
}

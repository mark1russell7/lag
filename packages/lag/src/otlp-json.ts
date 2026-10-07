/**
 * A minimal OTLP/HTTP JSON encoder for log records. The worker uses it to
 * send hang reports without the OpenTelemetry SDK.
 *
 * See https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding.
 */

export type OtlpAttributeValue = string | number | boolean;

export type OtlpLogRecordInput = {
    /** Absolute time in milliseconds since the Unix epoch. */
    timeMs : number;
    eventName : string;
    severityText : string;
    severityNumber : number;
    body : string;
    attributes : Record<string, OtlpAttributeValue>;
};

type AnyValue = { stringValue : string } | { doubleValue : number } | { intValue : string } | { boolValue : boolean };
type KeyValue = { key : string; value : AnyValue };

function encodeValue(value : OtlpAttributeValue) : AnyValue {
    if (typeof value === "string") return { stringValue : value };
    if (typeof value === "boolean") return { boolValue : value };
    return Number.isInteger(value) ? { intValue : String(value) } : { doubleValue : value };
}

function encodeAttributes(attributes : Record<string, OtlpAttributeValue>) : KeyValue[] {
    return Object.entries(attributes).map(([key, value]) => ({ key, value : encodeValue(value) }));
}

/**
 * Milliseconds to the decimal nanosecond string that OTLP JSON uses. The
 * value is rounded to whole microseconds: a double at Unix-epoch size has no
 * correct digits below that, and browser clocks are not finer than 5 μs.
 */
export function millisToUnixNanoString(timeMs : number) : string {
    const wholeMs = Math.floor(timeMs);
    const micros = Math.round((timeMs - wholeMs) * 1_000);
    return (BigInt(wholeMs) * 1_000_000n + BigInt(micros) * 1_000n).toString();
}

/** Encodes log records as an OTLP `ExportLogsServiceRequest` JSON body. */
export function encodeOtlpLogs(
    resource : Record<string, string>,
    scopeName : string,
    records : readonly OtlpLogRecordInput[],
) : string {
    return JSON.stringify({
        resourceLogs : [{
            resource : { attributes : encodeAttributes(resource) },
            scopeLogs : [{
                scope : { name : scopeName },
                logRecords : records.map(r => ({
                    timeUnixNano : millisToUnixNanoString(r.timeMs),
                    observedTimeUnixNano : millisToUnixNanoString(r.timeMs),
                    eventName : r.eventName,
                    severityNumber : r.severityNumber,
                    severityText : r.severityText,
                    body : { stringValue : r.body },
                    attributes : encodeAttributes(r.attributes),
                })),
            }],
        }],
    });
}

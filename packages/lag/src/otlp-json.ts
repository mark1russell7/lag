/**
 * A minimal OTLP/HTTP JSON encoder for log records. The worker uses it to
 * send hang reports without the OpenTelemetry SDK.
 *
 * Refer to https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding.
 */

export type OtlpAttributeValue = string | number | boolean;

export type OtlpLogRecordInput = {
    /** The time of the occurrence, in milliseconds since the Unix epoch. */
    timeMs : number;
    /** The time of the record, in milliseconds since the Unix epoch. The default is `timeMs`. */
    observedTimeMs? : number;
    eventName : string;
    severityText : string;
    severityNumber : number;
    body : string;
    attributes : Record<string, OtlpAttributeValue>;
};

type AnyValue = { stringValue : string } | { doubleValue : number } | { intValue : string } | { boolValue : boolean };
type KeyValue = { key : string; value : AnyValue };

/**
 * A safe integer becomes `intValue`, and each other number becomes
 * `doubleValue`. `String()` of a large integer (for example 1e21) gives an
 * exponent, and OTLP does not accept it as an int64.
 */
function encodeValue(value : OtlpAttributeValue) : AnyValue {
    if (typeof value === "string") return { stringValue : value };
    if (typeof value === "boolean") return { boolValue : value };
    return Number.isSafeInteger(value) ? { intValue : String(value) } : { doubleValue : value };
}

function encodeAttributes(attributes : Record<string, OtlpAttributeValue>) : KeyValue[] {
    return Object.entries(attributes).map(([key, value]) => ({ key, value : encodeValue(value) }));
}

/**
 * This function changes milliseconds to the decimal string of nanoseconds
 * that OTLP JSON uses. It rounds the value to whole microseconds. A double of
 * Unix-epoch size has no correct digits below 1 μs. Also, browser clocks are
 * not finer than 5 μs.
 */
export function millisToUnixNanoString(timeMs : number) : string {
    const wholeMs = Math.floor(timeMs);
    const micros = Math.round((timeMs - wholeMs) * 1_000);
    return (BigInt(wholeMs) * 1_000_000n + BigInt(micros) * 1_000n).toString();
}

/** This function encodes log records as the JSON body of an OTLP `ExportLogsServiceRequest`. */
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
                    observedTimeUnixNano : millisToUnixNanoString(r.observedTimeMs ?? r.timeMs),
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

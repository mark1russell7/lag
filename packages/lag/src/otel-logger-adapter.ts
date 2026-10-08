import type { Logger } from "./types.js";
import type { AttributeValue } from "./meter.js";
import type { EventSink } from "./events.js";
import { formatEventLine } from "./event-line.js";

// Duck-typed OTel Logger interface — matches @opentelemetry/api-logs Logger
// without taking a hard dependency on the OTel package.
export type OtelLogger = {
    emit(logRecord : {
        eventName? : string;
        severityText? : string;
        severityNumber? : number;
        body? : string;
        attributes? : Record<string, AttributeValue>;
        timestamp? : number;
    }) : void;
};

// OTel SeverityNumber values per spec
const SEVERITY_MAP : Record<string, number> = {
    trace : 1,
    debug : 5,
    info : 9,
    warn : 13,
    error : 17,
    fatal : 21,
};

type Primitive = string | number | boolean;

function isPrimitive(value : unknown) : value is Primitive {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isPrimitiveArray(value : unknown) : value is string[] | number[] | boolean[] {
    if (!Array.isArray(value)) return false;
    const first : unknown = value[0];
    return value.every(v => isPrimitive(v) && typeof v === typeof first);
}

/**
 * An OTel attribute value must be a primitive, or an array of primitives of
 * one type. Exporters drop all other values. Thus, an `Error` becomes the
 * `exception.*` attributes of the semantic conventions. Other objects become
 * JSON strings.
 */
function toAttributes(args : unknown) : Record<string, AttributeValue> {
    const attributes : Record<string, AttributeValue> = {};
    if (args === undefined || args === null) return attributes;
    if (typeof args !== "object") {
        attributes["args"] = isPrimitive(args) ? args : String(args);
        return attributes;
    }

    for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        if (value instanceof Error) {
            attributes["exception.type"] = value.name;
            attributes["exception.message"] = value.message;
            if (value.stack) attributes["exception.stacktrace"] = value.stack;
        } else if (isPrimitive(value) || isPrimitiveArray(value)) {
            attributes[key] = value;
        } else {
            try {
                attributes[key] = JSON.stringify(value);
            } catch {
                attributes[key] = String(value);
            }
        }
    }
    return attributes;
}

export function createOtelLoggerAdapter(otelLogger : OtelLogger) : Logger {
    return {
        log(level : string, message : string, args : unknown) : void {
            otelLogger.emit({
                severityText : level,
                severityNumber : SEVERITY_MAP[level.toLowerCase()] ?? 9, // unknown levels → INFO
                body : message,
                attributes : toAttributes(args),
            });
        },
    };
}

/**
 * This function makes an event sink that sends each event as an OTel log
 * record with `eventName`. The OpenTelemetry conventions for events make
 * `eventName` necessary. The sink removes the attributes that have no value.
 * The body has the name and the attributes (refer to `formatEventLine`).
 */
export function createOtelEventSink(otelLogger : OtelLogger) : EventSink {
    return {
        emit(name, attributes) {
            const clean : Record<string, AttributeValue> = {};
            for (const [key, value] of Object.entries(attributes)) {
                if (value !== undefined && value !== null) clean[key] = value;
            }
            otelLogger.emit({
                eventName : name,
                severityText : "INFO",
                severityNumber : 9,
                body : formatEventLine(name, clean),
                attributes : clean,
            });
        },
    };
}

// Tee adapter — fans out to multiple Loggers (e.g., console + OTel)
export function createTeeLogger(...loggers : Logger[]) : Logger {
    return {
        log(level : string, message : string, args : unknown) : void {
            for (const l of loggers) {
                try {
                    l.log(level, message, args);
                } catch {
                    // swallow logger errors so one bad logger doesn't break others
                }
            }
        },
    };
}

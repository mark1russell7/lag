import type { Logger } from "./types.js";
import type { AttributeValue } from "./meter.js";

// Duck-typed OTel Logger interface — matches @opentelemetry/api-logs Logger
// without taking a hard dependency on the OTel package.
export type OtelLogger = {
    emit(logRecord : {
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
 * OTel attribute values must be primitives or homogeneous primitive arrays;
 * exporters drop anything else. Errors become the semantic-convention
 * `exception.*` attributes, other objects are JSON-encoded.
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

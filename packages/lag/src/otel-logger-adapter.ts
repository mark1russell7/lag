import type { Logger } from "./types.js";

// Duck-typed OTel Logger interface — matches @opentelemetry/api-logs Logger
// without taking a hard dependency on the OTel package.
export type OtelLogger = {
    emit(logRecord : {
        severityText? : string;
        severityNumber? : number;
        body? : string;
        attributes? : Record<string, unknown>;
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

export function createOtelLoggerAdapter(otelLogger : OtelLogger) : Logger {
    return {
        log(level : string, message : string, args : unknown) : void {
            const severityNumber = SEVERITY_MAP[level.toLowerCase()] ?? 9;
            const attributes : Record<string, unknown> = {};

            if (args !== undefined && args !== null) {
                if (typeof args === "object") {
                    Object.assign(attributes, args as Record<string, unknown>);
                } else {
                    attributes["args"] = args;
                }
            }

            otelLogger.emit({
                severityText : level,
                severityNumber,
                body : message,
                attributes,
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

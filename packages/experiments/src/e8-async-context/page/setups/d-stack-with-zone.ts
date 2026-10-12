import type { ContextManagerOption } from "@mark1russell7/otel-ts";
import type { SetupId } from "../../shared/types.js";

/**
 * Setup D: `contextManager: "stack"`, with otel-ts as the package is. otel-ts
 * imports `@opentelemetry/context-zone` for all values of the option, and
 * that module loads zone.js. Thus zone.js patches the page also here.
 */
export const setup : SetupId = "D";
export const contextManager : ContextManagerOption = "stack";

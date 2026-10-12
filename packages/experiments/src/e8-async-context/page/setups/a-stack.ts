import type { ContextManagerOption } from "@mark1russell7/otel-ts";
import type { SetupId } from "../../shared/types.js";

/**
 * Setup A: no async context. The `StackContextManager` patches nothing. The
 * build replaces `@opentelemetry/context-zone`, thus zone.js does not load.
 */
export const setup : SetupId = "A";
export const contextManager : ContextManagerOption = "stack";

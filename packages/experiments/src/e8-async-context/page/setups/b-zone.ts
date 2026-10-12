import type { ContextManagerOption } from "@mark1russell7/otel-ts";
import type { SetupId } from "../../shared/types.js";

/** Setup B: the default of otel-ts. zone.js patches `Promise`, the timers and the event listeners. */
export const setup : SetupId = "B";
export const contextManager : ContextManagerOption = "zone";

// This import must be first: it installs the patches before the other modules of the page load
import "async-browser-context";
import { AsyncContextManager } from "async-browser-context/opentelemetry";
import type { ContextManagerOption } from "@mark1russell7/otel-ts";
import type { SetupId } from "../../shared/types.js";

/**
 * Setup C: async-browser-context. Its Vite plugin transforms each module of
 * the page, also the dependencies. The build replaces
 * `@opentelemetry/context-zone`, thus zone.js does not load.
 */
export const setup : SetupId = "C";
export const contextManager : ContextManagerOption = new AsyncContextManager();

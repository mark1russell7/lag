import { describe, expectTypeOf, it } from "vitest";
import type { AllMonitorDeps, PeerDeps, createInstrumentedPeerHangWatch } from "./index.js";

// The type checker (pnpm typecheck) does these checks: at run time, expectTypeOf does nothing
describe("the public API", () => {
    it("exports the dependency groups that the public functions use", () => {
        expectTypeOf<Parameters<typeof createInstrumentedPeerHangWatch>[0]>().toExtend<PeerDeps>();
        expectTypeOf<AllMonitorDeps>().toExtend<Partial<PeerDeps>>();
    });
});

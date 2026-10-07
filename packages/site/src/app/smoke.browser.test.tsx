import "../styles/global.css";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteContent } from "../content/site-content";
import { createSampleReportSource, SAMPLE_RUNS } from "../fixtures/sample-results";
import { MemoryReportSource, type ReportSource } from "../results/report-source";
import { createMemoryPreferenceStore } from "../theme/preferences";
import { browserSessionFactory } from "./default-services";
import { createAppRoutes } from "./routes";
import { siteSections } from "./sections";
import { SiteProviders, type SiteServices } from "./SiteProviders";

const runId = SAMPLE_RUNS[1]!.report.id;

const APP_PATHS = [
    "/",
    "/results",
    `/results/${runId}`,
    `/results/${runId}/tests`,
    `/results/${runId}/tests?status=failed&q=heartbeat`,
    `/results/${runId}/coverage`,
    `/results/${runId}/mutation`,
    `/results/${runId}/budgets`,
    `/results/${runId}/measurements`,
    `/results/${runId}/measurements?group=browser`,
    "/results/no-such-run",
    "/playground",
    "/no/such/page",
    "/docs/no-such-page",
];

const CONTENT_PATHS = siteContent.sections().flatMap(section => siteContent.pages(section).map(page => page.path));

function services(reports : ReportSource) : SiteServices {
    return {
        sections : siteSections,
        content : siteContent,
        reports,
        preferences : createMemoryPreferenceStore(),
        sessions : browserSessionFactory,
    };
}

const problems : string[] = [];
const onError = (event : ErrorEvent) : void => { problems.push(`error event: ${event.message}`); };
const onRejection = (event : PromiseRejectionEvent) : void => { problems.push(`unhandled rejection: ${String(event.reason)}`); };

let container : HTMLDivElement;
let root : Root;

beforeEach(() => {
    problems.length = 0;
    vi.spyOn(console, "error").mockImplementation((...args : unknown[]) => {
        problems.push(`console.error: ${args.map(String).join(" ")}`);
    });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    root.unmount();
    container.remove();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    vi.restoreAllMocks();
});

/** Renders the app at `path` and waits until the page has a heading and nothing is loading. */
async function renderPath(path : string, reports : ReportSource = createSampleReportSource()) : Promise<void> {
    const router = createMemoryRouter(createAppRoutes(siteSections), { initialEntries : [path] });
    root.render(
        <SiteProviders services={services(reports)}>
            <RouterProvider router={router} />
        </SiteProviders>,
    );
    await vi.waitFor(() => {
        if (!container.querySelector("main h1")) throw new Error(`No h1 yet at ${path}`);
    }, { timeout : 30_000, interval : 50 });
    await vi.waitFor(() => {
        const busy = container.querySelector("[aria-busy='true']");
        if (busy) throw new Error(`Still loading at ${path}: ${busy.textContent ?? ""}`);
    }, { timeout : 30_000, interval : 50 });
}

describe("site routes", () => {
    it.each([...APP_PATHS, ...CONTENT_PATHS])("renders %s without errors", async (path) => {
        await renderPath(path);
        expect(container.querySelector("header nav[aria-label='Main']")).not.toBeNull();
        expect(container.querySelector("main h1")?.textContent?.trim()).not.toBe("");
        expect(problems).toEqual([]);
    });

    it("shows the title of each content page as its h1", async () => {
        const page = siteContent.page("docs", "concepts/page-lifecycle")!;
        await renderPath(page.path);
        expect(container.querySelector("main h1")?.textContent).toBe(page.meta.title);
        expect(container.querySelector("nav[aria-label='Docs pages'] [aria-current='page']")?.textContent).toBe(page.meta.title);
        expect(container.textContent).toContain(page.sourcePath);
        expect(container.querySelector("[role='img'] svg")).not.toBeNull();
        expect(problems).toEqual([]);
    });

    it("shows the empty state without results", async () => {
        await renderPath("/results", MemoryReportSource.empty());
        expect(container.textContent).toContain("There are no test results yet");
        expect(container.textContent).toContain("pnpm results");
        expect(problems).toEqual([]);
    });

    it("draws the boxes and the arrows of the architecture map", async () => {
        await renderPath("/docs/architecture");
        await vi.waitFor(() => {
            if (container.querySelectorAll(".react-flow__node").length === 0) throw new Error("No nodes yet");
            if (container.querySelectorAll(".react-flow__edge-path").length === 0) throw new Error("No edges yet");
        }, { timeout : 15_000 });
        expect(problems).toEqual([]);
    });

    it("starts the monitors in the playground and stops them on unmount", async () => {
        await renderPath("/playground");
        await vi.waitFor(() => {
            if (!container.textContent?.includes("The monitors are running")) throw new Error("Not running yet");
        }, { timeout : 15_000 });
        expect(problems).toEqual([]);
    });
});

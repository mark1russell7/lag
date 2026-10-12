/** The machine and the exact versions of the packages of a run. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The folder of @lag/experiments. */
export const PACKAGE_DIR = path.resolve(here, "../../..");
export const REPO_ROOT = path.resolve(PACKAGE_DIR, "../..");

export type Machine = {
    cpu : string;
    logicalCores : number;
    memoryGiB : number;
    os : string;
    node : string;
    /** "ac", "battery", "no battery" or "unknown". Only Windows gives a value. */
    power : string;
};

function power() : string {
    if (process.platform !== "win32") return "unknown";
    try {
        const status = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Battery).BatteryStatus"], { encoding : "utf8", timeout : 20_000 }).trim();
        if (status === "") return "no battery";
        // Win32_Battery.BatteryStatus: 1, 4 and 5 are on battery; the other values are on AC power
        return ["1", "4", "5"].includes(status) ? "battery" : "ac";
    } catch {
        return "unknown";
    }
}

export function machine() : Machine {
    return {
        cpu : os.cpus()[0]?.model.trim() ?? "unknown",
        logicalCores : os.cpus().length,
        memoryGiB : Math.round(os.totalmem() / 2 ** 30),
        os : `${os.version()} (${os.platform()} ${os.release()})`,
        node : process.version,
        power : power(),
    };
}

function readVersion(dir : string) : string {
    return (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version : string }).version;
}

/** The real folder of a dependency of the package in `dir`. pnpm puts the dependencies of a package beside it. */
function dependencyDir(dir : string, name : string) : string | undefined {
    const own = path.join(dir, "node_modules", name);
    if (existsSync(own)) return realpathSync(own);
    const scopeDepth = (path.basename(path.dirname(dir)).startsWith("@") ? 2 : 1);
    const besides = path.join(path.resolve(dir, ...Array<string>(scopeDepth).fill("..")), name);
    return existsSync(besides) ? realpathSync(besides) : undefined;
}

function version(dir : string, name : string) : string {
    const found = dependencyDir(dir, name);
    return found ? readVersion(found) : "not installed";
}

/** The commit of otel-ts in the lockfile: the package comes from GitHub. */
function otelTsCommit() : string {
    const lock = readFileSync(path.join(REPO_ROOT, "pnpm-lock.yaml"), "utf8");
    return /otel-ts\/tar\.gz\/([0-9a-f]{40})/.exec(lock)?.[1] ?? "unknown";
}

function repoCommit() : string {
    try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd : REPO_ROOT, encoding : "utf8" }).trim();
    } catch {
        return "unknown";
    }
}

/** The versions of the packages that the page and the runner use. */
export function packageVersions() : Record<string, string> {
    const otelTs = dependencyDir(PACKAGE_DIR, "@mark1russell7/otel-ts");
    const asyncContext = dependencyDir(PACKAGE_DIR, "async-browser-context");
    const vite = dependencyDir(PACKAGE_DIR, "vite");
    return {
        "lag (repository commit)" : repoCommit(),
        "@mark1russell7/lag" : version(PACKAGE_DIR, "@mark1russell7/lag"),
        "@mark1russell7/otel-ts" : `${version(PACKAGE_DIR, "@mark1russell7/otel-ts")} (commit ${otelTsCommit()})`,
        "@opentelemetry/api" : version(PACKAGE_DIR, "@opentelemetry/api"),
        "@opentelemetry/sdk-trace-web" : otelTs ? version(otelTs, "@opentelemetry/sdk-trace-web") : "unknown",
        "@opentelemetry/context-zone" : otelTs ? version(otelTs, "@opentelemetry/context-zone") : "unknown",
        "@opentelemetry/context-zone-peer-dep" : version(PACKAGE_DIR, "@opentelemetry/context-zone-peer-dep"),
        "zone.js" : otelTs ? version(otelTs, "zone.js") : "unknown",
        "async-browser-context" : version(PACKAGE_DIR, "async-browser-context"),
        "@babel/core (of async-browser-context)" : asyncContext ? version(asyncContext, "@babel/core") : "unknown",
        "vite" : version(PACKAGE_DIR, "vite"),
        "rollup (of vite)" : vite ? version(vite, "rollup") : "unknown",
        "playwright" : version(PACKAGE_DIR, "playwright"),
    };
}

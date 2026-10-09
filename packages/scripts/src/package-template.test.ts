import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_DEV_DEPENDENCIES, configs, packageFiles, refusal, workspaceVersions, type Manifest } from "./package-template.js";

const packagesDir = resolve(import.meta.dirname, "../..");

/** The package.json files of the workspace. The test only reads them. */
const manifests : Manifest[] = readdirSync(packagesDir)
    .map(dir => join(packagesDir, dir, "package.json"))
    .filter(file => existsSync(file))
    .map(file => JSON.parse(readFileSync(file, "utf-8")) as Manifest);

describe("pnpm new", () => {
    it("refuses an existing folder, unless --force", () => {
        expect(refusal("lag", true, [], false)).toBe("packages/lag exists already. Use --force to write its package.json and tsconfig.json again.");
        expect(refusal("lag", true, [], true)).toBeUndefined();
        expect(refusal("fresh", false, manifests, false)).toBeUndefined();
    });

    it("refuses the name of a package in another folder, also with --force", () => {
        // packages/lag-integration-tests has the name @lag/integration-tests
        expect(refusal("integration-tests", false, manifests, true)).toBe("Another folder has the package @lag/integration-tests already.");
    });

    it("adds the devDependencies that the types of each TypeScript config need, with the versions of the workspace", () => {
        const versions = new Map([["@types/node", "^25.3.0"], ["vite", "^7.3.1"], ["@types/react", "^19.3.0"]]);
        const devDependencies = (config : (typeof configs)[number]["value"]) => packageFiles("x", config, versions).packageJson["devDependencies"];

        expect(devDependencies("ts")).toBeUndefined();
        expect(devDependencies("node")).toEqual({ "@types/node" : "^25.3.0" });
        expect(devDependencies("node-cjs")).toEqual({ "@types/node" : "^25.3.0" });
        expect(devDependencies("vite")).toEqual({ vite : "^7.3.1" });
        expect(devDependencies("react")).toEqual({ vite : "^7.3.1", "@types/react" : "^19.3.0" });
    });

    it("gives a dependency for each `types` entry of the config files", () => {
        const configDir = resolve(packagesDir, "../ts/config");
        const typesOf = (config : string) : string[] => {
            const json = JSON.parse(readFileSync(join(configDir, `${config}.json`), "utf-8")) as { extends? : string | string[]; compilerOptions? : { types? : string[] } };
            const parents = json.extends === undefined ? [] : [json.extends].flat().map(parent => parent.replace(/^\.\//, "").replace(/\.json$/, ""));
            return [...(json.compilerOptions?.types ?? []), ...parents.flatMap(typesOf)];
        };
        for (const { value } of configs) {
            const packages = typesOf(value).map(type => (type === "node" ? "@types/node" : type.split("/")[0]!));
            for (const name of packages) expect(CONFIG_DEV_DEPENDENCIES[value], `${value}: ${name}`).toContain(name);
        }
    });

    it("finds a version in the workspace for each devDependency of each config", () => {
        const versions = workspaceVersions(manifests);
        for (const { value } of configs) expect(() => packageFiles("x", value, versions), value).not.toThrow();
    });

    it("takes the range with the highest version when two packages differ", () => {
        const versions = workspaceVersions([
            { devDependencies : { "@types/node" : "^25.2.3", vite : "^7.3.1" } },
            { dependencies : { "@types/node" : "^25.3.0" }, devDependencies : { vite : "^7.0.0" } },
        ]);
        expect(versions.get("@types/node")).toBe("^25.3.0");
        expect(versions.get("vite")).toBe("^7.3.1");
    });

    it("makes the package.json and the tsconfig.json of an ESM and a CommonJS package", () => {
        const esm = packageFiles("thing", "ts", new Map());
        expect(esm).toEqual({
            packageJson : {
                name : "@lag/thing",
                version : "0.0.0",
                private : true,
                type : "module",
                main : "dist/index.js",
                types : "dist/index.d.ts",
                exports : { "." : { types : "./dist/index.d.ts", import : "./dist/index.js" } },
                scripts : { build : "tsc -b" },
            },
            tsconfig : { $schema : "https://json.schemastore.org/tsconfig", extends : "../../ts/config/ts.json" },
        });
        const cjs = packageFiles("thing", "node-cjs", new Map([["@types/node", "^25.3.0"]])).packageJson;
        expect(cjs["type"]).toBeUndefined();
        expect(cjs["exports"]).toEqual({ "." : { types : "./dist/index.d.ts", require : "./dist/index.js" } });
    });

    it("fails when no workspace package uses a necessary devDependency", () => {
        expect(() => packageFiles("x", "vite", new Map())).toThrow("No workspace package uses vite: its version is not known.");
    });
});

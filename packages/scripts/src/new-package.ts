import * as p from "@clack/prompts";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const packagesDir = join(root, "packages");
const rootTsconfigPath = join(root, "tsconfig.json");

const configs = [
  { value: "ts", label: "ts — ESM library" },
  { value: "node", label: "node — Node.js ESM" },
  { value: "node-cjs", label: "node-cjs — Node.js CommonJS" },
  { value: "vite", label: "vite — Vite / browser" },
  { value: "react", label: "react — React (JSX)" },
] as const;

type Config = (typeof configs)[number]["value"];

async function main(): Promise<void> {
  p.intro("New @lag package");

  const name = await p.text({
    message: "Package name (without @lag/)",
    validate: (v) => {
      if (!v) return "Required";
      if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Lowercase alphanumeric with hyphens";
      return undefined;
    },
  });

  if (p.isCancel(name)) {
    p.cancel();
    process.exit(0);
  }

  const config = (await p.select({
    message: "TypeScript config",
    options: [...configs],
  })) as Config;

  if (p.isCancel(config)) {
    p.cancel();
    process.exit(0);
  }

  const pkgDir = join(packagesDir, name);
  const srcDir = join(pkgDir, "src");
  const isEsm = config !== "node-cjs";

  const s = p.spinner();
  s.start("Creating package");

  mkdirSync(srcDir, { recursive: true });

  // package.json
  const pkg: Record<string, unknown> = {
    name: `@lag/${name}`,
    version: "0.0.0",
    private: true,
    ...(isEsm ? { type: "module" } : {}),
    main: "dist/index.js",
    types: "dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        ...(isEsm ? { import: "./dist/index.js" } : { require: "./dist/index.js" }),
      },
    },
    scripts: {
      build: "tsc -b",
    },
  };

  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  // tsconfig.json
  const tsconfig = {
    $schema: "https://json.schemastore.org/tsconfig",
    extends: `../../ts/config/${config}.json`,
  };

  writeFileSync(join(pkgDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");

  // src/index.ts
  writeFileSync(join(srcDir, "index.ts"), "");

  // Update root tsconfig.json references
  const rootTsconfig = JSON.parse(readFileSync(rootTsconfigPath, "utf-8")) as {
    references: { path: string }[];
  };

  const ref = { path: `packages/${name}` };
  if (!rootTsconfig.references) rootTsconfig.references = [];
  const exists = rootTsconfig.references.some((r) => r.path === ref.path);
  if (!exists) {
    rootTsconfig.references.push(ref);
    rootTsconfig.references.sort((a, b) => a.path.localeCompare(b.path));
    writeFileSync(rootTsconfigPath, JSON.stringify(rootTsconfig, null, 2) + "\n");
  }

  s.stop("Package created");

  p.note(`cd packages/${name}`, "Next steps");
  p.outro(`@lag/${name} is ready`);
}

main();

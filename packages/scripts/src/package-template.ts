/**
 * The pure part of `pnpm new`: the files of a new package. The module does
 * no I/O, so the unit tests can make packages without a change to the
 * repository.
 */

export const configs = [
  { value: "ts", label: "ts — ESM library" },
  { value: "node", label: "node — Node.js ESM" },
  { value: "node-cjs", label: "node-cjs — Node.js CommonJS" },
  { value: "vite", label: "vite — Vite / browser" },
  { value: "react", label: "react — React (JSX)" },
] as const;

export type Config = (typeof configs)[number]["value"];

/**
 * The devDependencies that each TypeScript config needs. `node.json` sets
 * `types: ["node"]` and `vite.json` sets `types: ["vite/client"]`. Without
 * the packages, `tsc` gives TS2688, also for the `tsc -b` of the root.
 * `react.json` also needs the JSX types of React.
 */
export const CONFIG_DEV_DEPENDENCIES: Readonly<Record<Config, readonly string[]>> = {
  ts: [],
  node: ["@types/node"],
  "node-cjs": ["@types/node"],
  vite: ["vite"],
  react: ["vite", "@types/react"],
};

/** The parts of a package.json that the generator reads. */
export type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export function validateName(v: string | undefined): string | undefined {
  if (!v) return "Required";
  if (!/^[a-z][a-z0-9-]*$/.test(v)) return "Lowercase alphanumeric with hyphens";
  return undefined;
}

export function isConfig(v: string | undefined): v is Config {
  return configs.some((c) => c.value === v);
}

function versionParts(range: string): number[] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(range);
  return match ? match.slice(1).map(Number) : [];
}

function compareRanges(a: string, b: string): number {
  const [pa, pb] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The version range of each dependency of the workspace packages. When two
 * packages use different ranges, the range with the highest version wins.
 */
export function workspaceVersions(manifests: readonly Manifest[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const manifest of manifests) {
    for (const [dependency, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const current = versions.get(dependency);
      if (current === undefined || compareRanges(range, current) > 0) versions.set(dependency, range);
    }
  }
  return versions;
}

/**
 * The reason why the generator must not write the package, or `undefined`.
 * An existing folder is a reason, except with `force`. A package with the
 * same name in another folder (`others`) is always a reason.
 */
export function refusal(
  name: string,
  folderExists: boolean,
  others: readonly Manifest[],
  force: boolean,
): string | undefined {
  if (others.some((m) => m.name === `@lag/${name}`)) return `Another folder has the package @lag/${name} already.`;
  if (folderExists && !force) return `packages/${name} exists already. Use --force to write its package.json and tsconfig.json again.`;
  return undefined;
}

export type PackageFiles = {
  packageJson: Record<string, unknown>;
  tsconfig: Record<string, unknown>;
};

/** The package.json and the tsconfig.json of a new package. */
export function packageFiles(name: string, config: Config, versions: ReadonlyMap<string, string>): PackageFiles {
  const isEsm = config !== "node-cjs";
  const devDependencies = Object.fromEntries(
    CONFIG_DEV_DEPENDENCIES[config].map((dependency) => {
      const range = versions.get(dependency);
      if (range === undefined) throw new Error(`No workspace package uses ${dependency}: its version is not known.`);
      return [dependency, range];
    }),
  );
  return {
    packageJson: {
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
      ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {}),
    },
    tsconfig: {
      $schema: "https://json.schemastore.org/tsconfig",
      extends: `../../ts/config/${config}.json`,
    },
  };
}

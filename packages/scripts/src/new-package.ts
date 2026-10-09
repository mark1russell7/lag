import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  configs,
  isConfig,
  packageFiles,
  refusal,
  validateName,
  workspaceVersions,
  type Config,
  type Manifest,
} from "./package-template.js";

const root = resolve(import.meta.dirname, "../../..");
const packagesDir = join(root, "packages");
const rootTsconfigPath = join(root, "tsconfig.json");

/**
 * This function reads the value of a flag, for example `--name <name>` or
 * `--config <config>`. If the value is missing, the caller asks for it
 * interactively.
 */
function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function askName(): Promise<string> {
  const fromArgs = readArg("--name");
  if (fromArgs !== undefined) {
    const error = validateName(fromArgs);
    if (error) throw new Error(`--name: ${error}`);
    return fromArgs;
  }
  const name = await p.text({ message: "Package name (without @lag/)", validate: validateName });
  if (p.isCancel(name)) {
    p.cancel();
    process.exit(0);
  }
  return name;
}

async function askConfig(): Promise<Config> {
  const fromArgs = readArg("--config");
  if (fromArgs !== undefined) {
    if (!isConfig(fromArgs)) throw new Error(`--config: one of ${configs.map((c) => c.value).join(", ")}`);
    return fromArgs;
  }
  const config = await p.select({ message: "TypeScript config", options: [...configs] });
  if (p.isCancel(config)) {
    p.cancel();
    process.exit(0);
  }
  return config;
}

/** The folder and the package.json of each workspace package. */
function readManifests(): Array<{ dir: string; manifest: Manifest }> {
  return readdirSync(packagesDir)
    .filter((dir) => existsSync(join(packagesDir, dir, "package.json")))
    .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf-8")) as Manifest }));
}

async function main(): Promise<void> {
  p.intro("New @lag package");

  const name = await askName();
  const config = await askConfig();

  const pkgDir = join(packagesDir, name);
  const srcDir = join(pkgDir, "src");
  const packages = readManifests();
  const others = packages.filter((entry) => entry.dir !== name).map((entry) => entry.manifest);

  // An existing package must not lose its package.json and its source
  const reason = refusal(name, existsSync(pkgDir), others, process.argv.includes("--force"));
  if (reason) throw new Error(reason);
  const files = packageFiles(name, config, workspaceVersions(packages.map((entry) => entry.manifest)));

  const s = p.spinner();
  s.start("Creating package");

  mkdirSync(srcDir, { recursive: true });

  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(files.packageJson, null, 2) + "\n");
  writeFileSync(join(pkgDir, "tsconfig.json"), JSON.stringify(files.tsconfig, null, 2) + "\n");

  // src/index.ts: --force keeps the existing source
  const indexPath = join(srcDir, "index.ts");
  if (!existsSync(indexPath)) writeFileSync(indexPath, "");

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

  p.note(`pnpm install\ncd packages/${name}`, "Next steps");
  p.outro(`@lag/${name} is ready`);
}

main().catch((error: unknown) => {
  p.cancel(String(error));
  process.exit(1);
});

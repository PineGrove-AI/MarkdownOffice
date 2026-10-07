import { dirname, join } from "jsr:@std/path";
import * as ui from "./ui.ts";

// ── Astro runtime ───────────────────────────────────────────────────────
// Slides are built as an Astro site. Astro (and its node_modules) is
// installed once into a shared runtime dir in the user's cache; each deck
// gets its own project dir *below* it, so Node module resolution walks up
// and finds the shared install without symlinks or per-deck installs.
//
//   ~/.cache/mdo/astro/
//     package.json, node_modules/     shared runtime
//     decks/<deck>-<hash>/            generated Astro project per deck

const TEMPLATE_ROOT = new URL("../templates/slides/", import.meta.url);

/** Read a file from the bundled Astro project template (templates/slides). */
export function readSlidesTemplate(path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, TEMPLATE_ROOT));
}

/** mdo's cache directory (Astro runtime, downloaded browser). */
export function cacheDir(): string {
  if (Deno.build.os === "windows") {
    return join(Deno.env.get("LOCALAPPDATA") ?? join(Deno.env.get("USERPROFILE") ?? "", "AppData", "Local"), "mdo");
  }
  return join(Deno.env.get("XDG_CACHE_HOME") ?? join(Deno.env.get("HOME") ?? "", ".cache"), "mdo");
}

export const runtimeDir = join(cacheDir(), "astro");

/** Directory holding the generated Astro project for one deck. */
export function deckProjectDir(id: string): string {
  return join(runtimeDir, "decks", id);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function requireCommand(name: string, hint: string): Promise<void> {
  try {
    await new Deno.Command(name, { args: ["--version"], stdout: "null", stderr: "null" }).output();
  } catch {
    throw new Error(`\`${name}\` not found. ${hint}`);
  }
}

/**
 * Make sure the shared Astro runtime is installed and matches the bundled
 * package.json. Installs (or reinstalls after an mdo upgrade) via npm.
 */
export async function ensureAstroRuntime(): Promise<void> {
  const pkg = await readSlidesTemplate("package.json");
  const pkgPath = join(runtimeDir, "package.json");

  let installedPkg = "";
  try {
    installedPkg = await Deno.readTextFile(pkgPath);
  } catch {
    // not installed yet
  }
  const hasAstro = await exists(join(runtimeDir, "node_modules", "astro", "package.json"));
  if (installedPkg === pkg && hasAstro) return;

  const hint = "mdo slides needs Node.js (>= 18.17) and npm: https://nodejs.org";
  await requireCommand("node", hint);
  await requireCommand("npm", hint);

  ui.info(`Installing Astro into ${ui.tidyPath(runtimeDir)} ${ui.dim("(one-time setup)")}`);
  await Deno.mkdir(runtimeDir, { recursive: true });
  await Deno.writeTextFile(pkgPath, pkg);

  const result = await new Deno.Command("npm", {
    args: ["install", "--no-audit", "--no-fund", "--loglevel=error"],
    cwd: runtimeDir,
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) {
    // Force a retry next time
    await Deno.remove(pkgPath).catch(() => {});
    throw new Error("npm install of the Astro runtime failed");
  }
}

function astroCommand(
  projectDir: string,
  args: string[],
  opts: { env?: Record<string, string>; inherit?: boolean } = {},
): Deno.Command {
  const astroBin = join(runtimeDir, "node_modules", "astro", "astro.js");
  const io = opts.inherit ? "inherit" : "piped";
  return new Deno.Command("node", {
    args: [astroBin, ...args, "--root", projectDir],
    // Astro resolves some intermediate paths against the cwd
    cwd: projectDir,
    env: { ASTRO_TELEMETRY_DISABLED: "1", ...opts.env },
    stdout: io,
    stderr: io,
  });
}

/** Run `astro build` for a project and return the path of the built index.html. */
export async function astroBuild(projectDir: string): Promise<string> {
  const { success, stdout, stderr } = await astroCommand(projectDir, ["build"]).output();

  if (!success) {
    const decoder = new TextDecoder();
    throw new Error(
      `astro build failed:\n${decoder.decode(stdout)}${decoder.decode(stderr)}`,
    );
  }

  return join(projectDir, "dist", "index.html");
}

/** Start `astro dev` for a project. Resolves once the process is spawned. */
export function astroDev(
  projectDir: string,
  publicDir: string,
  open: boolean,
): Deno.ChildProcess {
  const args = ["dev"];
  if (open) args.push("--open");
  return astroCommand(projectDir, args, {
    env: { MDO_PUBLIC_DIR: publicDir },
    inherit: true,
  }).spawn();
}

/**
 * Write a file only if its content changed, creating parent dirs.
 * Avoids needless reloads in the dev server.
 */
export async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await Deno.readTextFile(path) === content) return;
  } catch {
    // missing — write it
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, content);
}

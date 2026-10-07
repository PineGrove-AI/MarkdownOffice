import { join, toFileUrl } from "jsr:@std/path";
import { cacheDir } from "./astro.ts";
import * as ui from "./ui.ts";

// ── Headless browser for printing slides to PDF ─────────────────────────
// Slides are HTML, so a PDF needs a browser to render them. mdo uses, in
// order: $MDO_BROWSER, an installed Chrome / Chromium / Edge, or Google's
// chrome-headless-shell downloaded once into ~/.cache/mdo/browsers/.

interface Browser {
  path: string;
  /** chrome-headless-shell is always headless and takes plain --headless */
  headlessShell: boolean;
}

const browsersDir = join(cacheDir(), "browsers");

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Resolve a command name on PATH to an absolute path. */
async function which(name: string): Promise<string | null> {
  for (const dir of (Deno.env.get("PATH") ?? "").split(":")) {
    if (dir && await isFile(join(dir, name))) return join(dir, name);
  }
  return null;
}

async function installedBrowser(): Promise<string | null> {
  if (Deno.build.os === "darwin") {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Chromium.app/Contents/MacOS/Chromium",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    const roots = ["/Applications", join(Deno.env.get("HOME") ?? "", "Applications")];
    for (const root of roots) {
      for (const app of apps) {
        if (await isFile(join(root, app))) return join(root, app);
      }
    }
    return null;
  }
  const names = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ];
  for (const name of names) {
    const path = await which(name);
    if (path) return path;
  }
  return null;
}

/** A chrome-headless-shell previously downloaded into the cache, if any. */
async function cachedHeadlessShell(): Promise<string | null> {
  const root = join(browsersDir, "chrome-headless-shell");
  try {
    // <root>/<platform>-<version>/<build dir>/chrome-headless-shell
    // (alongside files such as .metadata)
    for await (const version of Deno.readDir(root)) {
      if (!version.isDirectory) continue;
      for await (const platform of Deno.readDir(join(root, version.name))) {
        if (!platform.isDirectory) continue;
        const path = join(root, version.name, platform.name, "chrome-headless-shell");
        if (await isFile(path)) return path;
      }
    }
  } catch {
    // nothing downloaded yet
  }
  return null;
}

async function downloadHeadlessShell(): Promise<string> {
  ui.info(`No Chrome/Chromium found, downloading chrome-headless-shell into ${ui.tidyPath(browsersDir)} ${ui.dim("(one-time setup)")}`);
  const { success, stdout, stderr } = await new Deno.Command("npx", {
    args: ["--yes", "@puppeteer/browsers", "install", "chrome-headless-shell@stable", "--path", browsersDir],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const out = new TextDecoder().decode(stdout);
  // Prints "chrome-headless-shell@<version> <path to executable>"
  const path = out.trim().split("\n").pop()?.split(" ").slice(1).join(" ");
  if (!success || !path || !await isFile(path)) {
    throw new Error(
      "Could not download chrome-headless-shell. Install Chrome or Chromium, " +
        `or set MDO_BROWSER to a Chromium-based browser.\n${out}${new TextDecoder().decode(stderr)}`,
    );
  }
  return path;
}

async function findBrowser(): Promise<Browser> {
  const override = Deno.env.get("MDO_BROWSER");
  if (override) {
    if (!await isFile(override)) throw new Error(`MDO_BROWSER not found: ${override}`);
    return { path: override, headlessShell: override.includes("headless-shell") };
  }

  const installed = await installedBrowser();
  if (installed) return { path: installed, headlessShell: false };

  const shell = await cachedHeadlessShell() ?? await downloadHeadlessShell();
  return { path: shell, headlessShell: true };
}

/** Size of a file, or -1 if it doesn't exist yet. */
async function fileSize(path: string): Promise<number> {
  try {
    return (await Deno.stat(path)).size;
  } catch {
    return -1;
  }
}

const PRINT_TIMEOUT_MS = 120_000;

/**
 * Print an HTML slide deck to PDF, one slide per 16:9 page (see the print
 * styles in global.css), with every reveal step shown.
 */
export async function printToPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const browser = await findBrowser();
  await Deno.remove(pdfPath).catch(() => {});

  const args = [
    // New headless mode uses its own temporary profile, so a running
    // browser's profile is never touched. (Passing --user-data-dir makes
    // Chrome hang after printing on macOS.)
    browser.headlessShell ? "--headless" : "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-pdf-header-footer",
    // Let fonts and the page script settle before printing
    "--virtual-time-budget=10000",
    `--print-to-pdf=${pdfPath}`,
  ];
  // Chrome refuses to run sandboxed as root (e.g. in CI containers)
  if (Deno.build.os === "linux" && Deno.uid() === 0) args.push("--no-sandbox");
  args.push(toFileUrl(htmlPath).href);

  const child = new Deno.Command(browser.path, {
    args,
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const stderr = new Response(child.stderr).text();

  // Some browser builds never exit after printing. Once the PDF has been
  // written and stops growing, give the browser a moment, then stop it.
  let exited = false;
  const status = child.status.then((s) => {
    exited = true;
    return s;
  });
  const started = Date.now();
  let lastSize = -1;
  let stableSince = 0;
  while (!exited && Date.now() - started < PRINT_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 250));
    const size = await fileSize(pdfPath);
    if (size > 0 && size === lastSize) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince > 2000) break;
    } else {
      stableSince = 0;
    }
    lastSize = size;
  }
  const stoppedByUs = !exited;
  if (stoppedByUs) child.kill();
  const { success } = await status;

  if ((await fileSize(pdfPath)) <= 0 || (!stoppedByUs && !success)) {
    throw new Error(
      `Printing to PDF failed with ${browser.path}:\n${await stderr}`,
    );
  }
}

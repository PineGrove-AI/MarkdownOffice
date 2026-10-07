import { relative } from "jsr:@std/path";

// Terminal output helpers: colours, symbols, spinners and the config card.
// Colours are off when NO_COLOR is set or stdout isn't a terminal, and the
// spinner only runs when stderr is a terminal, so logs and CI stay plain.

const color = !Deno.env.get("NO_COLOR") && Deno.stdout.isTerminal();
const interactive = Deno.stderr.isTerminal();
const truecolor = /truecolor|24bit/i.test(Deno.env.get("COLORTERM") ?? "");

const sgr = (open: number, close: number) => (s: string) =>
  color ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const red = sgr(31, 39);
export const green = sgr(32, 39);
export const yellow = sgr(33, 39);
export const cyan = sgr(36, 39);

/** Colour text with a hex colour (#RGB or #RRGGBB). Other values are left plain. */
export function hex(value: string, s: string): string {
  const m = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!color || !m) return s;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (truecolor) return `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
  const c6 = (v: number) => Math.round((v / 255) * 5);
  return `\x1b[38;5;${16 + 36 * c6(r) + 6 * c6(g) + c6(b)}m${s}\x1b[39m`;
}

/** A path relative to the cwd when inside it, otherwise with ~ for home. */
export function tidyPath(path: string): string {
  const rel = relative(Deno.cwd(), path);
  if (!rel.startsWith("..")) return rel || ".";
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  return home && path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Spinner ─────────────────────────────────────────────────────────────

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const encoder = new TextEncoder();
let spinner: { text: string; frame: number } | null = null;

function writeErr(s: string): void {
  Deno.stderr.writeSync(encoder.encode(s));
}

function drawSpinner(): void {
  if (!spinner) return;
  const frame = FRAMES[spinner.frame++ % FRAMES.length];
  writeErr(`\r\x1b[2K  ${cyan(frame)} ${spinner.text}${dim("...")}`);
}

/** Print a line without tearing a running spinner. */
function print(line: string, stream: "out" | "err" = "out"): void {
  if (spinner) writeErr("\r\x1b[2K");
  (stream === "out" ? console.log : console.error)(line);
  drawSpinner();
}

/** Run a slow step with a spinner showing `text` while it runs. */
export async function step<T>(text: string, fn: () => Promise<T>): Promise<T> {
  if (!interactive || spinner) return await fn();
  const timer = setInterval(drawSpinner, 80);
  spinner = { text, frame: 0 };
  drawSpinner();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    spinner = null;
    writeErr("\r\x1b[2K");
  }
}

// ── Messages ────────────────────────────────────────────────────────────

export function blank(): void {
  print("");
}

export function info(msg: string): void {
  print(`  ${cyan("›")} ${msg}`);
}

export function success(msg: string): void {
  print(`  ${green("✓")} ${msg}`);
}

export function warn(msg: string): void {
  print(`  ${yellow("▲")} ${yellow(msg)}`, "err");
}

export function error(msg: string): void {
  const [first, ...rest] = msg.split("\n");
  print(`  ${red("✗")} ${red(first)}${rest.map((l) => `\n    ${l}`).join("")}`, "err");
}

/** Indented, dimmed output from a tool such as pandoc. */
export function toolOutput(text: string): void {
  for (const line of text.trimEnd().split("\n")) print(dim(`    ${line}`), "err");
}

/** "✓ out.pdf  2 sources · 231 KB · 1.2s" for a file that was just written. */
export async function generated(path: string, startedAt: number, sources?: number): Promise<void> {
  const size = await Deno.stat(path).then((s) => formatBytes(s.size), () => null);
  const details = [
    sources !== undefined ? `${sources} source${sources === 1 ? "" : "s"}` : null,
    size,
    formatDuration(performance.now() - startedAt),
  ].filter(Boolean).join(" · ");
  success(`${bold(tidyPath(path))}  ${dim(details)}`);
}

export function watching(count: number): void {
  print("");
  print(`  ${cyan("◉")} Watching ${count} file${count === 1 ? "" : "s"} for changes ${dim("· Ctrl+C to stop")}`);
}

/** A watch-mode rebuild header: "12:04:01 ↻ report.md changed" */
export function changed(paths: string[]): void {
  const names = [...new Set(paths.map(tidyPath))].join(", ");
  print("");
  print(`  ${timestamp()} ${cyan("↻")} ${names} changed`);
}

export function timestamp(): string {
  return dim(new Date().toLocaleTimeString([], { hour12: false }));
}

// ── Config card ─────────────────────────────────────────────────────────

export interface CardInfo {
  /** Path of the mdo-config.json in use */
  source: string;
  /** "project" or "global" */
  scope: string;
  companyPrefix: string;
  companyHighlight: string;
  brandColor: string;
  logo: string | null;
  /** Placeholder parts still in use, e.g. ["branding", "logo"] */
  placeholders: string[];
}

let lastCard = "";

/**
 * Show which config and logo a render uses, with the company name and brand
 * colour as they'll look. Printed once, and again only if it changes
 * (so watch mode stays quiet between rebuilds).
 */
export function configCard(c: CardInfo): void {
  const key = JSON.stringify(c);
  if (key === lastCard) return;
  lastCard = key;

  const bar = hex(c.brandColor, "▍");
  const label = (s: string) => dim(s.padEnd(7));
  print("");
  print(`  ${bar} ${bold(c.companyPrefix)}${bold(hex(c.brandColor, c.companyHighlight))}`);
  print(`  ${bar} ${label("config")} ${tidyPath(c.source)} ${dim(`(${c.scope})`)}`);
  print(`  ${bar} ${label("color")} ${hex(c.brandColor, "██")} ${c.brandColor}`);
  print(`  ${bar} ${label("logo")} ${c.logo ? tidyPath(c.logo) : dim("none")}`);
  if (c.placeholders.includes("branding")) {
    warn(`Placeholder branding: edit ${tidyPath(c.source)} with your company name and colour`);
  }
  if (c.placeholders.includes("logo") && c.logo) {
    warn(`Placeholder logo: replace ${tidyPath(c.logo)} with your own logo.png or logo.svg`);
  }
  print("");
}

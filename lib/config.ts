import { dirname, join } from "jsr:@std/path";
import { placeholderParts, writeSampleConfig } from "./sample-config.ts";
import * as ui from "./ui.ts";

const CONFIG_FILENAME = "mdo-config.json";

export interface BrandConfig {
  company_name_prefix: string;
  company_name_highlight: string;
  brand_color: string;
  confidentiality_label: string;
  /** Max heading depth for the PDF table of contents (1–6, default 3). */
  toc_depth?: number;
  /** Optional slide colours, keyed by SLIDES_THEME_KEYS or raw "--css-var" names */
  slides_theme?: Record<string, string>;
}

/** slides_theme keys → the CSS custom properties they set in the slide design. */
export const SLIDES_THEME_KEYS: Record<string, string> = {
  background: "--bg",
  background_cream: "--bg-cream",
  background_dark: "--bg-dark",
  background_cover: "--bg-cover",
  backdrop: "--backdrop",
  text: "--ink",
  text_secondary: "--ink-2",
  text_muted: "--ink-3",
  text_on_dark: "--on-dark",
  accent: "--brand",
  accent_deep: "--brand-deep",
  callout: "--callout",
  line: "--line",
  rule: "--line-strong",
  font: "--font-sans",
  mono_font: "--font-mono",
};

export interface ConfigResult {
  config: BrandConfig;
  source: string;
}

/** Platform-appropriate global config directory. */
export function globalConfigDir(): string {
  if (Deno.build.os === "windows") {
    return join(Deno.env.get("APPDATA") ?? join(Deno.env.get("USERPROFILE") ?? "", "AppData", "Roaming"), "mdo");
  }
  return join(Deno.env.get("XDG_CONFIG_HOME") ?? join(Deno.env.get("HOME") ?? "", ".config"), "mdo");
}

function parseAndValidate(text: string, path: string): BrandConfig {
  const raw = JSON.parse(text);

  const required = [
    "company_name_prefix",
    "company_name_highlight",
    "brand_color",
    "confidentiality_label",
  ] as const;

  for (const key of required) {
    if (typeof raw[key] !== "string") {
      throw new Error(`${path}: missing or invalid field "${key}"`);
    }
  }

  if (raw.toc_depth !== undefined) {
    if (!Number.isInteger(raw.toc_depth) || raw.toc_depth < 1 || raw.toc_depth > 6) {
      throw new Error(`${path}: "toc_depth" must be an integer between 1 and 6`);
    }
  }

  if (raw.slides_theme !== undefined) {
    const theme = raw.slides_theme;
    if (
      typeof theme !== "object" || theme === null || Array.isArray(theme) ||
      Object.values(theme).some((v) => typeof v !== "string")
    ) {
      throw new Error(`${path}: "slides_theme" must be an object of string values`);
    }
    for (const key of Object.keys(theme)) {
      if (!key.startsWith("--") && !(key in SLIDES_THEME_KEYS)) {
        throw new Error(
          `${path}: unknown slides_theme key "${key}". ` +
            `Valid keys: ${Object.keys(SLIDES_THEME_KEYS).join(", ")} ` +
            `(or a raw CSS custom property such as "--my-var")`,
        );
      }
    }
  }

  return raw as BrandConfig;
}

/**
 * Load branding config with the following resolution order:
 * 1. rootDir/mdo-config.json (project-level)
 * 2. ~/.config/mdo/mdo-config.json (global default)
 *
 * Returns the parsed config and which path it was loaded from.
 */
export async function loadConfig(rootDir: string): Promise<ConfigResult> {
  const localPath = join(rootDir, CONFIG_FILENAME);
  const globalPath = join(globalConfigDir(), CONFIG_FILENAME);

  // Fall through only when a file is missing — invalid JSON or config
  // errors are reported rather than silently skipped.
  for (const path of [localPath, globalPath]) {
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
    return { config: parseAndValidate(text, path), source: path };
  }

  // First run: no config anywhere. Create a placeholder global config (and
  // logo) so rendering works out of the box, and say loudly that it did.
  const created = await writeSampleConfig(globalConfigDir());
  ui.blank();
  ui.warn(`No ${CONFIG_FILENAME} found, so mdo created a placeholder global config:`);
  for (const path of created) ui.info(`created ${ui.tidyPath(path)}`);
  ui.info(`Edit it with your own branding and logo, or run ${ui.bold("mdo init")} for a project-level config.`);
  return { config: parseAndValidate(await Deno.readTextFile(globalPath), globalPath), source: globalPath };
}

const LOGO_NAMES = ["logo.png", "logo.svg"];

/** Find the logo: project root first, then the global config dir. */
export async function findLogo(rootDir: string): Promise<string | null> {
  for (const dir of [rootDir, globalConfigDir()]) {
    for (const name of LOGO_NAMES) {
      try {
        return await Deno.realPath(join(dir, name));
      } catch {
        // try next
      }
    }
  }
  return null;
}

/** Print which config and logo a render uses (see ui.configCard). */
export async function showConfig({ config, source }: ConfigResult, logo: string | null): Promise<void> {
  ui.configCard({
    source,
    scope: dirname(source) === globalConfigDir() ? "global" : "project",
    companyPrefix: config.company_name_prefix,
    companyHighlight: config.company_name_highlight,
    brandColor: config.brand_color,
    logo,
    placeholders: await placeholderParts(config, logo),
  });
}

import { join } from "jsr:@std/path";
import type { BrandConfig } from "./config.ts";

// Deliberately loud placeholders: magenta branding, "YOUR LOGO" and a
// confidentiality label that says where to edit, so a document rendered with
// the sample config is obviously unbranded.

export const SAMPLE_CONFIG = `{
  "_readme": "PLACEHOLDER CONFIG created by mdo. Replace the values below with your own branding, and swap logo.svg in this directory for your logo (logo.png or logo.svg). See https://github.com/MagerlinC/markdown-office#configuration",
  "company_name_prefix": "Your",
  "company_name_highlight": "Company",
  "brand_color": "#FF00FF",
  "confidentiality_label": "Placeholder branding - edit mdo-config.json",
  "toc_depth": 3
}
`;

export const SAMPLE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <rect x="3" y="3" width="114" height="114" rx="16" fill="#FFE6FF" stroke="#FF00FF" stroke-width="4" stroke-dasharray="10 6"/>
  <text x="60" y="56" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#FF00FF">YOUR</text>
  <text x="60" y="82" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#FF00FF">LOGO</text>
</svg>
`;

/** Write a file unless it already exists. Returns true if it was written. */
export async function writeIfMissing(path: string, content: string): Promise<boolean> {
  try {
    await Deno.writeTextFile(path, content, { createNew: true });
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) return false;
    throw e;
  }
}

/**
 * Write the sample mdo-config.json, plus the placeholder logo.svg when the
 * directory has no logo yet. Existing files are left alone.
 * Returns the paths that were created.
 */
export async function writeSampleConfig(dir: string): Promise<string[]> {
  await Deno.mkdir(dir, { recursive: true });
  const created: string[] = [];

  const configPath = join(dir, "mdo-config.json");
  if (await writeIfMissing(configPath, SAMPLE_CONFIG)) created.push(configPath);

  const hasPng = await Deno.stat(join(dir, "logo.png")).then(() => true, () => false);
  const logoPath = join(dir, "logo.svg");
  if (!hasPng && await writeIfMissing(logoPath, SAMPLE_LOGO)) created.push(logoPath);

  return created;
}

/** Which placeholder parts ("branding", "logo") a config and logo still use. */
export async function placeholderParts(config: BrandConfig, logo: string | null): Promise<string[]> {
  const sample = JSON.parse(SAMPLE_CONFIG) as BrandConfig;
  const parts: string[] = [];
  if (
    config.brand_color.toUpperCase() === sample.brand_color ||
    config.confidentiality_label === sample.confidentiality_label
  ) {
    parts.push("branding");
  }
  if (logo && await Deno.readTextFile(logo).then((t) => t === SAMPLE_LOGO, () => false)) {
    parts.push("logo");
  }
  return parts;
}

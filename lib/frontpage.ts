import { type BrandConfig, findLogo, globalConfigDir } from "./config.ts";
import type { DocMeta } from "./frontmatter.ts";
import { resolveTemplateContent } from "./templates.ts";

/**
 * Read the frontpage.typ template and substitute placeholders
 * with branding config and document metadata.
 */
export async function buildFrontpage(
  rootDir: string,
  config: BrandConfig,
  meta: DocMeta,
): Promise<string> {
  let template = await resolveTemplateContent("frontpage.typ", rootDir);

  const logoPath = await findLogo(rootDir);
  if (!logoPath) {
    throw new Error(
      `No logo file found (expected logo.png or logo.svg in ${rootDir} or ${globalConfigDir()})`,
    );
  }

  const replacements: Record<string, string> = {
    "%%COMPANY_PREFIX%%": config.company_name_prefix,
    "%%COMPANY_HIGHLIGHT%%": config.company_name_highlight,
    "%%BRAND_COLOR%%": config.brand_color,
    "%%CONFIDENTIALITY%%": config.confidentiality_label,
    "%%LOGO_PATH%%": logoPath,
    "%%TITLE%%": meta.title,
    "%%SUBTITLE%%": meta.subtitle,
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    template = template.replaceAll(placeholder, value);
  }

  return template;
}

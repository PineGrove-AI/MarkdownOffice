// ── Slide fonts ─────────────────────────────────────────────────────────
// Fonts are loaded from Google Fonts at view time, like the original
// pinegrove deck. `font` / `mono_font` in slides_theme take a family name
// ("Lora") or a full CSS font-family stack ("Lora, Georgia, serif"); the
// first family in the stack is loaded from Google Fonts when available.

import * as ui from "./ui.ts";

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

/** The stylesheet the design was built with (Inter + JetBrains Mono). */
const DEFAULT_FONTS_HREF = `${GOOGLE_FONTS_CSS}?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap`;

interface FontRole {
  cssVar: string;
  default: string;
  fallback: string;
  /** Google serves whichever of these weights a family has */
  weights: string;
}

const ROLES: Record<"font" | "mono_font", FontRole> = {
  font: {
    cssVar: "--font-sans",
    default: "Inter",
    fallback: "system-ui, sans-serif",
    weights: "400;500;600;700;800",
  },
  mono_font: {
    cssVar: "--font-mono",
    default: "JetBrains Mono",
    fallback: "ui-monospace, monospace",
    weights: "400;500;600;700",
  },
};

export const FONT_KEYS = Object.keys(ROLES);

export interface SlideFonts {
  /** Google Fonts stylesheet to load, or null if there is nothing to load */
  href: string | null;
  /** CSS custom properties to set (only for customised fonts) */
  vars: [string, string][];
}

function googleFamilyParam(family: string, weights: string): string {
  return `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${weights}`;
}

/** Whether Google Fonts knows a family, cached per process (watch mode). */
const availability = new Map<string, Promise<boolean>>();

function onGoogleFonts(family: string, weights: string): Promise<boolean> {
  if (!availability.has(family)) {
    const url = `${GOOGLE_FONTS_CSS}?${googleFamilyParam(family, weights)}`;
    availability.set(
      family,
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then(async (res) => {
          await res.body?.cancel();
          // 400 = unknown family; anything else we can't judge, so load it
          return res.status !== 400;
        })
        .catch(() => {
          ui.warn(`Could not reach Google Fonts to check "${family}"`);
          return true;
        }),
    );
  }
  return availability.get(family)!;
}

/** Resolve the slides_theme font settings into a stylesheet URL and CSS vars. */
export async function resolveFonts(theme: Record<string, string>): Promise<SlideFonts> {
  if (!FONT_KEYS.some((k) => theme[k])) {
    return { href: DEFAULT_FONTS_HREF, vars: [] };
  }

  const params: string[] = [];
  const vars: [string, string][] = [];

  for (const [key, role] of Object.entries(ROLES)) {
    const value = theme[key]?.trim();
    const family = (value ? value.split(",")[0] : role.default)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (value) {
      const stack = value.includes(",") ? value : `'${family}', ${role.fallback}`;
      vars.push([role.cssVar, stack]);
    }

    if (!value || await onGoogleFonts(family, role.weights)) {
      params.push(googleFamilyParam(family, role.weights));
    } else {
      ui.warn(
        `"${family}" is not on Google Fonts; it will only show where it is installed locally`,
      );
    }
  }

  return {
    href: params.length ? `${GOOGLE_FONTS_CSS}?${params.join("&")}&display=swap` : null,
    vars,
  };
}

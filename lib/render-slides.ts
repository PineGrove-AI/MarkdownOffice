// deno-lint-ignore-file no-explicit-any
import { basename, dirname, extname, isAbsolute, join, resolve } from "jsr:@std/path";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { type BrandConfig, findLogo, loadConfig, showConfig, SLIDES_THEME_KEYS } from "./config.ts";
import * as ui from "./ui.ts";
import { type DocMeta, extractFrontmatter } from "./frontmatter.ts";
import { expandIncludes } from "./includes.ts";
import { FONT_KEYS, resolveFonts, type SlideFonts } from "./fonts.ts";
import {
  astroBuild,
  deckProjectDir,
  ensureAstroRuntime,
  readSlidesTemplate,
  runtimeDir,
  writeIfChanged,
} from "./astro.ts";
import type { RenderOptions, RenderResult } from "./render.ts";

// ── Overview ────────────────────────────────────────────────────────────
// Markdown → pandoc JSON AST → slide models → Astro project → astro build.
//
// The generated Astro project mirrors the pinegrove-slides layout:
//
//   src/styles/global.css           design system (templates/slides)
//   src/components/Brand.astro      header wordmark + logo
//   src/pages/index.astro           page shell + reveal/navigation script
//   content/<deck>/slides.astro     imports every slide in order
//   content/<deck>/slides/NN-*.astro  one file per slide
//
// Slides are split at `# H1` (new section), `## H2` (sub-slide) and `---`
// (continuation). Pandoc attributes on a heading control the slide:
//   {.dark} {.cream} {.cover} {.center} {.no-rule} {.no-subtitle}
//   {eyebrow="..."} {label="..."} {left="..."} {right="..."}
// A paragraph directly after the heading becomes the subtitle, and `. . .`
// splits the rest of the slide into reveal steps.

type Block = { t: string; c?: any };
type Inline = { t: string; c?: any };
type Attr = [string, string[], [string, string][]];

const PANDOC_FROM = "markdown+lists_without_preceding_blankline";

/** A lead paragraph longer than this stays body text instead of becoming the subtitle. */
const SUBTITLE_MAX_LENGTH = 140;

/** Classes that pick a layout rather than a colour variant. */
const LAYOUT_CLASSES = ["cover", "center"];
/** Classes that only affect a single slide and are never inherited. */
const LOCAL_CLASSES = [...LAYOUT_CLASSES, "no-subtitle"];

interface Slide {
  layout: "content" | "center" | "cover";
  classes: string[];
  label: string;
  eyebrow: string;
  /** Plain-text title, used for file names and comments */
  name: string;
  title: string;
  subtitle: string;
  body: string;
  metaLeft: string;
  metaRight: string;
  /** Show the logo next to the subtitle (generated title slide only) */
  logoMark: boolean;
  /** Footer number ("00", "01", ...) — cover slides have none */
  number: string | null;
}

// ── Pandoc ──────────────────────────────────────────────────────────────

async function pandoc(args: string[], input: string): Promise<string> {
  const proc = new Deno.Command("pandoc", {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const { stdout, success } = await proc.output();
  if (!success) {
    throw new Error(`pandoc failed (${args.join(" ")})`);
  }
  return new TextDecoder().decode(stdout);
}

let noHighlight: Promise<string> | null = null;

/**
 * The option that turns off syntax highlighting: `--syntax-highlighting=none`
 * in newer pandoc; older pandoc (e.g. from apt on Linux) only knows the
 * since-deprecated `--no-highlight`.
 */
function noHighlightFlag(): Promise<string> {
  noHighlight ??= new Deno.Command("pandoc", { args: ["--help"], stdout: "piped", stderr: "null" })
    .output()
    .then(({ stdout }) =>
      new TextDecoder().decode(stdout).includes("--syntax-highlighting")
        ? "--syntax-highlighting=none"
        : "--no-highlight"
    );
  return noHighlight;
}

/**
 * Collects block fragments and converts all of them to HTML with a single
 * pandoc call, separating them with raw HTML comment markers.
 */
class HtmlBatch {
  private fragments: Block[][] = [];

  constructor(private apiVersion: number[]) {}

  add(blocks: Block[]): number {
    this.fragments.push(blocks);
    return this.fragments.length - 1;
  }

  async render(): Promise<string[]> {
    const blocks: Block[] = [];
    this.fragments.forEach((frag, i) => {
      blocks.push({ t: "RawBlock", c: ["html", `<!--mdo:fragment:${i}-->`] });
      blocks.push(...frag);
    });
    const doc = { "pandoc-api-version": this.apiVersion, meta: {}, blocks };
    const html = await pandoc(
      ["--from=json", "--to=html", await noHighlightFlag()],
      JSON.stringify(doc),
    );
    const parts = html.split(/<!--mdo:fragment:\d+-->/);
    return parts.slice(1).map((p) => p.trim());
  }
}

// ── AST helpers ─────────────────────────────────────────────────────────

/** Flatten inlines to plain text. */
function stringify(inlines: Inline[]): string {
  let out = "";
  for (const il of inlines) {
    switch (il.t) {
      case "Str":
        out += il.c;
        break;
      case "Space":
      case "SoftBreak":
      case "LineBreak":
        out += " ";
        break;
      case "Code":
      case "Math":
        out += il.c[1];
        break;
      case "Emph":
      case "Strong":
      case "Underline":
      case "Strikeout":
      case "Superscript":
      case "Subscript":
      case "SmallCaps":
        out += stringify(il.c);
        break;
      case "Span":
      case "Link":
      case "Quoted":
      case "Cite":
        out += stringify(il.c[1]);
        break;
    }
  }
  return out;
}

/** `*emphasis*` in headings becomes the brand-coloured accent word. */
function emphToBrand(inlines: Inline[]): Inline[] {
  return inlines.map((il) => {
    if (il.t === "Emph") {
      return { t: "Span", c: [["", ["brand-word"], []], emphToBrand(il.c)] };
    }
    if (il.t === "Strong") return { t: "Strong", c: emphToBrand(il.c) };
    return il;
  });
}

/** `. . .` on its own line — pandoc's slide pause. */
function isPause(b: Block): boolean {
  return b.t === "Para" && stringify(b.c) === ". . .";
}

/**
 * Prepare body blocks for HTML conversion:
 * - Mark lists that should reveal item by item. Pandoc lists carry no
 *   attributes, so a raw marker is placed before them and turned into
 *   class="reveal" after HTML conversion.
 * - Wrap raw HTML blocks in a .raw-html div.
 */
function markIncrementalLists(blocks: Block[], incremental: boolean): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.t === "RawBlock" && b.c[0] === "html" && !isHtmlComment(b.c[1])) {
      // Raw HTML (e.g. a ```{=html} diagram) is laid out by its own markup,
      // not by the markdown content styles — see .raw-html in global.css
      out.push({ t: "Div", c: [["", ["raw-html"], []], [b]] });
    } else if (b.t === "BulletList" || b.t === "OrderedList") {
      if (incremental) out.push({ t: "RawBlock", c: ["html", "<!--mdo:reveal-->"] });
      out.push(b);
    } else if (b.t === "Div") {
      const [attr, inner] = b.c as [Attr, Block[]];
      const inc = attr[1].includes("incremental")
        ? true
        : attr[1].includes("nonincremental")
        ? false
        : incremental;
      out.push({ t: "Div", c: [attr, markIncrementalLists(inner, inc)] });
    } else {
      out.push(b);
    }
  }
  return out;
}

function isHtmlComment(html: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/.test(html);
}

function applyRevealMarkers(html: string): string {
  return html.replace(
    /<!--mdo:reveal-->\s*<(ul|ol)([^>]*)>/g,
    (_, tag: string, attrs: string) =>
      attrs.includes('class="')
        ? `<${tag}${attrs.replace('class="', 'class="reveal ')}>`
        : `<${tag} class="reveal"${attrs}>`,
  );
}

// ── Images ──────────────────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

async function fileDataUri(path: string): Promise<string> {
  const mime = IMAGE_MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${encodeBase64(await Deno.readFile(path))}`;
}

/**
 * Inline local <img src> and SVG <image href> sources as data URIs so the
 * built HTML is self-contained.
 */
async function inlineImages(html: string, searchDirs: string[]): Promise<string> {
  const re = /(<img\b[^>]*?\ssrc="|<image\b[^>]*?\s(?:xlink:)?href=")([^"]+)(")/g;
  const replacements = new Map<string, string>();

  for (const [, , src] of html.matchAll(re)) {
    if (replacements.has(src) || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    let rel = src.replaceAll("&amp;", "&");
    try {
      rel = decodeURIComponent(rel);
    } catch {
      // keep as-is
    }
    const candidates = isAbsolute(rel) ? [rel] : searchDirs.map((d) => join(d, rel));
    for (const path of candidates) {
      try {
        replacements.set(src, await fileDataUri(path));
        break;
      } catch {
        // try next
      }
    }
    if (!replacements.has(src)) {
      ui.warn(`Image not found: ${src}`);
    }
  }

  return html.replace(re, (m, pre: string, src: string, post: string) => {
    const uri = replacements.get(src);
    return uri ? pre + uri + post : m;
  });
}

/** Width / height of a PNG or SVG, used to size the CSS background logo. */
async function logoAspectRatio(path: string): Promise<number> {
  const bytes = await Deno.readFile(path);
  if (path.endsWith(".png") && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const w = view.getUint32(16);
    const h = view.getUint32(20);
    if (w && h) return w / h;
  }
  if (path.endsWith(".svg")) {
    const svg = new TextDecoder().decode(bytes);
    const viewBox = svg.match(/viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (viewBox) return Number(viewBox[1]) / Number(viewBox[2]);
    const w = svg.match(/<svg[^>]*\swidth="([\d.]+)/);
    const h = svg.match(/<svg[^>]*\sheight="([\d.]+)/);
    if (w && h) return Number(w[1]) / Number(h[1]);
  }
  return 1;
}

// ── Markdown → slides ───────────────────────────────────────────────────

interface Section {
  text: string;
  classes: string[];
}

interface RawSlide {
  heading?: { level: number; attr: Attr; inlines: Inline[] };
  section: Section;
  blocks: Block[];
  /** The slide a `---` continuation follows */
  previous?: RawSlide;
}

interface CoverText {
  title: Inline[];
  subtitle: Inline[];
}

/** Split top-level blocks into slides; also pick out the cover text divs. */
function splitSlides(blocks: Block[]): { raw: RawSlide[]; cover: CoverText } {
  const raw: RawSlide[] = [];
  const cover: CoverText = { title: [], subtitle: [] };
  let section: Section | null = null;
  let current: RawSlide | null = null;

  // The document's top heading level starts sections and the next level
  // starts sub-slides — usually # and ##, but e.g. ## and ### in a README
  // whose title is raw HTML.
  const levels = blocks.filter((b) => b.t === "Header").map((b) => b.c[0] as number);
  const top = levels.length ? Math.min(...levels) : 1;

  for (const b of blocks) {
    if (!section && b.t === "Div") {
      // Content before the first section heading is ignored, except the cover
      // text injected by renderSlides.
      const [attr, inner] = b.c as [Attr, Block[]];
      const inlines = inner[0]?.c ?? [];
      if (attr[1].includes("mdo-cover-title")) cover.title = inlines;
      if (attr[1].includes("mdo-cover-subtitle")) cover.subtitle = inlines;
      continue;
    }

    if (b.t === "Header" && b.c[0] <= top + 1) {
      const [absLevel, attr, inlines] = b.c as [number, Attr, Inline[]];
      const level = absLevel - top + 1; // 1 = section, 2 = sub-slide
      if (level === 1) section = { text: stringify(inlines), classes: attr[1] };
      if (!section) continue;
      current = { heading: { level, attr, inlines }, section, blocks: [] };
      raw.push(current);
    } else if (b.t === "HorizontalRule") {
      if (!current || !section) continue;
      current = { section, blocks: [], previous: current };
      raw.push(current);
    } else if (current) {
      current.blocks.push(b);
    }
  }

  return { raw, cover };
}

function slideClasses(s: RawSlide): string[] {
  const own = s.heading?.attr[1] ?? [];
  if (own.length > 0) return own;
  const inherited = s.previous ? slideClasses(s.previous) : s.section.classes;
  return inherited.filter((c) => !LOCAL_CLASSES.includes(c));
}

function slideLabel(s: RawSlide): string {
  const kv = new Map(s.heading?.attr[2] ?? []);
  if (kv.has("label")) return kv.get("label")!;
  return s.previous ? slideLabel(s.previous) : s.section.text;
}

function slideName(s: RawSlide): string {
  if (s.heading) return stringify(s.heading.inlines);
  return s.previous ? `${slideName(s.previous).replace(/ \(cont\.\)$/, "")} (cont.)` : s.section.text;
}

async function buildSlides(
  markdown: string,
  meta: DocMeta,
  imageDirs: string[] | null,
): Promise<Slide[]> {
  const ast = JSON.parse(await pandoc([`--from=${PANDOC_FROM}`, "--to=json"], markdown));
  const { raw, cover } = splitSlides(ast.blocks);
  const batch = new HtmlBatch(ast["pandoc-api-version"]);

  interface Pending {
    slide: Omit<Slide, "title" | "subtitle" | "body">;
    title: number | null;
    subtitle: number | null;
    body: number[];
  }
  const pending: Pending[] = [];

  // Title slide from front matter (skipped when there's nothing to show)
  if (cover.title.length || cover.subtitle.length) pending.push({
    slide: {
      layout: "cover",
      classes: ["cover"],
      label: meta.coverLabel,
      eyebrow: "",
      name: "cover",
      metaLeft: meta.coverLeft,
      metaRight: meta.coverRight,
      logoMark: true,
      number: null,
    },
    title: batch.add([{ t: "Plain", c: emphToBrand(cover.title) }]),
    subtitle: cover.subtitle.length ? batch.add([{ t: "Plain", c: cover.subtitle }]) : null,
    body: [],
  });

  for (const s of raw) {
    const classes = slideClasses(s);
    const kv = new Map(s.heading?.attr[2] ?? []);
    const blocks = [...s.blocks];

    let subtitle: number | null = null;
    if (
      s.heading && !classes.includes("no-subtitle") && blocks[0]?.t === "Para" &&
      !isPause(blocks[0]) && stringify(blocks[0].c).length <= SUBTITLE_MAX_LENGTH
    ) {
      subtitle = batch.add([{ t: "Plain", c: blocks.shift()!.c }]);
    }

    // Split the body at `. . .` pauses into reveal steps
    const chunks: Block[][] = [[]];
    for (const b of blocks) {
      if (isPause(b)) chunks.push([]);
      else chunks[chunks.length - 1].push(b);
    }
    const hasBody = chunks.some((c) => c.length > 0);

    let layout: Slide["layout"] = classes.includes("cover")
      ? "cover"
      : classes.includes("center")
      ? "center"
      : "content";
    // A heading with nothing below it (e.g. "Questions?") is centred
    if (layout === "content" && s.heading && !hasBody) layout = "center";

    const eyebrow = kv.get("eyebrow") ??
      (s.heading?.level === 1 ? "" : s.section.text);

    pending.push({
      slide: {
        layout,
        classes,
        label: slideLabel(s),
        eyebrow,
        name: slideName(s),
        metaLeft: kv.get("left") ?? "",
        metaRight: kv.get("right") ?? "",
        logoMark: false,
        number: null,
      },
      title: s.heading ? batch.add([{ t: "Plain", c: emphToBrand(s.heading.inlines) }]) : null,
      subtitle,
      body: hasBody
        ? chunks.map((c) => batch.add(markIncrementalLists(c, meta.incremental)))
        : [],
    });
  }

  const html = await batch.render();
  const get = async (i: number | null) => {
    if (i === null) return "";
    const h = applyRevealMarkers(html[i]);
    return imageDirs ? await inlineImages(h, imageDirs) : h;
  };

  let counter = 0;
  const slides: Slide[] = [];
  for (const p of pending) {
    const [first, ...steps] = await Promise.all(p.body.map(get));
    let body = first ?? "";
    for (const step of steps) {
      body += `\n<div class="reveal"><div class="stack">\n${step}\n</div></div>`;
    }
    slides.push({
      ...p.slide,
      title: await get(p.title),
      subtitle: await get(p.subtitle),
      body: body.trim(),
      number: p.slide.layout === "cover" ? null : String(counter++).padStart(2, "0"),
    });
  }
  return slides;
}

// ── Slides → Astro files ────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

function pascalCase(slug: string): string {
  const name = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : `Slide${name}`;
}

/** `const name = "...";` lines for the Astro frontmatter. */
function consts(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`)
    .join("\n");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((l) => (l ? pad + l : l)).join("\n");
}

function slideComment(index: string, s: Slide): string {
  const name = s.name.toUpperCase().replace(/-{2,}/g, "-").replace(/>/g, "");
  return `<!-- ======== SLIDE ${index} — ${name} ======== -->`;
}

function slideAstro(index: string, s: Slide): string {
  const light = s.layout === "cover" || s.classes.includes("dark");
  const sectionClass = ["slide", ...s.classes.filter((c) => c !== "center")].join(" ");
  const brand = light ? `<Brand variant="light" />` : `<Brand />`;
  const label = s.label ? `<span>{label}</span>` : `<span></span>`;

  const imports = [`import Brand from "../../../src/components/Brand.astro";`];
  if (s.layout !== "cover") imports.push(`import brand from "../../../src/brand.json";`);
  const frontmatter = [
    imports.join("\n"),
    consts({
      label: s.label,
      eyebrow: s.eyebrow,
      title: s.title,
      subtitle: s.subtitle,
      body: s.body,
      metaLeft: s.metaLeft,
      metaRight: s.metaRight,
    }),
  ].filter(Boolean).join("\n\n");

  const header = `  <div class="deck-header">
    ${brand}
    ${label}
  </div>`;

  let main: string;
  let bottom: string;

  if (s.layout === "cover") {
    const logo = s.logoMark ? `\n  <span class="brand-logo logo-mark" aria-hidden="true"></span>` : "";
    const parts = [
      s.title && `<p class="tagline" set:html={title} />`,
      s.subtitle && (s.logoMark
        ? `<p class="subtitle cover-byline">\n  <Fragment set:html={subtitle} />${logo}\n</p>`
        : `<p class="subtitle cover-subtitle" set:html={subtitle} />`),
      s.body && `<div class="cover-content stack" set:html={body} />`,
    ].filter(Boolean).join("\n");
    main = `  <div class="cover-body">
    <div class="cover-text">
${indent(parts, 6)}
    </div>
  </div>`;
    bottom = `  <div class="meta">
    <div class="left">${s.metaLeft ? "{metaLeft}" : ""}</div>
    <div class="right">${s.metaRight ? "{metaRight}" : ""}</div>
  </div>`;
  } else {
    const heading = [
      s.eyebrow && `<p class="eyebrow">{eyebrow}</p>`,
      s.title && `<h2 class="title" set:html={title} />`,
      s.subtitle && `<p class="subtitle" set:html={subtitle} />`,
    ].filter(Boolean).join("\n");

    let inner: string;
    if (s.layout === "center") {
      const body = s.body ? `\n<div class="content stack" set:html={body} />` : "";
      inner = `<div class="stack centered">
${indent(heading + body, 2)}
</div>`;
    } else {
      const parts: string[] = [];
      if (heading) parts.push(`<div class="stack">\n${indent(heading, 2)}\n</div>`);
      if (heading && s.body && !s.classes.includes("no-rule")) parts.push(`<div class="rule"></div>`);
      if (s.body) parts.push(`<div class="content stack" set:html={body} />`);
      inner = `<div class="stack-loose">
${indent(parts.join("\n\n"), 2)}
</div>`;
    }

    main = `  <div class="center-y">
${indent(inner, 4)}
  </div>`;
    bottom = `  <div class="deck-footer">
    <span>{brand.name}</span>
    <span>${s.number}</span>
  </div>`;
  }

  return `---
${frontmatter}
---

${slideComment(index, s)}
<section class="${sectionClass}">
${header}

${main}

${bottom}
</section>
`;
}

interface DeckFiles {
  /** Paths relative to the deck's slides/ dir → content */
  slides: Map<string, string>;
  index: string;
}

function deckAstro(slides: Slide[]): DeckFiles {
  const files = new Map<string, string>();
  const imports: string[] = [];
  const tags: string[] = [];
  const used = new Set<string>();

  slides.forEach((s, i) => {
    const index = String(i).padStart(2, "0");
    const slug = slugify(s.name) || "slide";
    const file = `${index}-${slug}.astro`;
    let component = pascalCase(slug);
    while (used.has(component)) component += index;
    used.add(component);

    files.set(file, slideAstro(index, s));
    imports.push(`import ${component} from "./slides/${file}";`);
    tags.push(`<${component} />`);
  });

  return {
    slides: files,
    index: `---\n${imports.join("\n")}\n---\n\n${tags.join("\n")}\n`,
  };
}

// ── Project generation ──────────────────────────────────────────────────

async function themeCss(
  config: BrandConfig,
  logo: string | null,
  fonts: SlideFonts,
): Promise<string> {
  const vars: [string, string][] = [["--brand-deep", config.brand_color]];
  if (logo) {
    vars.push(["--brand-logo", `url("${await fileDataUri(logo)}")`]);
    vars.push(["--brand-logo-ratio", String(await logoAspectRatio(logo))]);
  }
  for (const [key, value] of Object.entries(config.slides_theme ?? {})) {
    if (FONT_KEYS.includes(key)) continue; // resolved into fonts.vars
    vars.push([SLIDES_THEME_KEYS[key] ?? key, value]);
  }
  vars.push(...fonts.vars);
  const body = vars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  return `/* Generated by mdo from mdo-config.json */\n:root {\n${body}\n}\n`;
}

async function hashId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface SlidesProject {
  projectDir: string;
  /** Directory relative image paths resolve against (served as public/ in dev) */
  assetDir: string;
  outputPath: string;
  sourceCount: number;
  watchFiles: string[];
}

/**
 * Generate (or update) the Astro project for a deck.
 *
 * mode "build" inlines local images so the built HTML is self-contained;
 * mode "dev" keeps relative paths, served from the markdown's directory.
 */
export async function prepareSlidesProject(
  options: RenderOptions,
  mode: "build" | "dev",
): Promise<SlidesProject> {
  const { rootDir } = options;
  const input = resolve(options.input);

  // ── Resolve input sources ───────────────────────────────────────────
  let sources: string[];
  let assetDir: string;
  let defaultOutput: string;

  const stat = await Deno.stat(input);
  if (stat.isDirectory) {
    const entries: string[] = [];
    for await (const entry of Deno.readDir(input)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        entries.push(join(input, entry.name));
      }
    }
    entries.sort();
    if (entries.length === 0) {
      throw new Error(`No .md files found in ${input}`);
    }
    sources = entries;
    assetDir = input;
    defaultOutput = join(dirname(input), `${basename(input)}.html`);
  } else {
    sources = [input];
    assetDir = dirname(input);
    defaultOutput = input.replace(/\.md$/, ".html");
  }

  const outputPath = resolve(options.output ?? defaultOutput);

  // ── Load branding config ────────────────────────────────────────────
  const loaded = await loadConfig(rootDir);
  const { config } = loaded;
  await showConfig(loaded, await findLogo(rootDir));

  const watchFiles = [...sources];

  // ── Expand includes ────────────────────────────────────────────────
  const expandedContents: string[] = [];

  for (const src of sources) {
    const text = await Deno.readTextFile(src);
    if (/^\s*!include\s/m.test(text)) {
      const { content, includedFiles } = await expandIncludes(src);
      expandedContents.push(content);
      watchFiles.push(...includedFiles);
    } else {
      expandedContents.push(text);
    }
  }

  // ── Front matter & merged markdown ────────────────────────────────
  const meta = extractFrontmatter(expandedContents[0]);
  const stripped = expandedContents.map((c) =>
    c.replace(/^---\n[\s\S]*?\n---\n?/, "")
  );
  // Cover text goes through pandoc too, so markdown in titles works
  const coverDivs = `::: mdo-cover-title\n${meta.title}\n:::\n\n` +
    `::: mdo-cover-subtitle\n${meta.subtitle}\n:::\n\n`;
  const fullMarkdown = coverDivs + stripped.join("\n\n");

  // ── Build slide models ────────────────────────────────────────────
  const imageDirs = mode === "build" ? [assetDir, rootDir] : null;
  const slides = await buildSlides(fullMarkdown, meta, imageDirs);
  const deck = deckAstro(slides);

  // ── Write the Astro project ───────────────────────────────────────
  const deckName = slugify(basename(input, ".md")) || "deck";
  const projectDir = deckProjectDir(`${deckName}-${await hashId(input)}`);
  const logo = await findLogo(rootDir);

  let customCss = "";
  try {
    customCss = await Deno.readTextFile(join(rootDir, "slides.css"));
    watchFiles.push(join(rootDir, "slides.css"));
  } catch {
    // no project stylesheet
  }

  const fonts = await resolveFonts(config.slides_theme ?? {});
  const fsAllow = JSON.stringify([runtimeDir, projectDir]);
  const files: Record<string, string> = {
    "astro.config.mjs": (await readSlidesTemplate("astro.config.mjs"))
      .replace("%%FS_ALLOW%%", fsAllow),
    "src/styles/global.css": await readSlidesTemplate("src/styles/global.css"),
    "src/styles/theme.css": await themeCss(config, logo, fonts),
    "src/styles/custom.css": customCss,
    "src/components/Brand.astro": await readSlidesTemplate("src/components/Brand.astro"),
    "src/pages/index.astro": (await readSlidesTemplate("src/pages/index.astro"))
      .replace("%%DECK%%", deckName),
    "src/brand.json": JSON.stringify({
      prefix: config.company_name_prefix,
      highlight: config.company_name_highlight,
      name: config.company_name_prefix + config.company_name_highlight,
      logo: logo !== null,
    }, null, 2) + "\n",
    "src/deck.json": JSON.stringify({
      title: stringifyTitle(meta.title),
      fonts: fonts.href,
    }, null, 2) + "\n",
  };

  for (const [path, content] of Object.entries(files)) {
    await writeIfChanged(join(projectDir, path), content);
  }
  await Deno.mkdir(join(projectDir, "public"), { recursive: true });

  // Slides first, then the index that imports them, then prune stale files
  const slidesDir = join(projectDir, "content", deckName, "slides");
  for (const [file, content] of deck.slides) {
    await writeIfChanged(join(slidesDir, file), content);
  }
  await writeIfChanged(join(projectDir, "content", deckName, "slides.astro"), deck.index);
  for await (const entry of Deno.readDir(slidesDir)) {
    if (!deck.slides.has(entry.name)) {
      await Deno.remove(join(slidesDir, entry.name));
    }
  }

  return {
    projectDir,
    assetDir,
    outputPath,
    sourceCount: sources.length,
    watchFiles: [...new Set(watchFiles)],
  };
}

/** Front matter titles may contain markdown emphasis; strip it for <title>. */
function stringifyTitle(title: string): string {
  return title.replace(/[*_`]/g, "");
}

export async function renderSlides(options: RenderOptions): Promise<RenderResult> {
  await ensureAstroRuntime();
  const project = await prepareSlidesProject(options, "build");

  const builtIndex = await ui.step("Building slides with Astro", () => astroBuild(project.projectDir));
  const html = await Deno.readTextFile(builtIndex);
  if (/(?:src|href)="\/_astro\//.test(html)) {
    ui.warn("Built slides reference external assets and may not be self-contained");
  }
  await Deno.mkdir(dirname(project.outputPath), { recursive: true });
  await Deno.writeTextFile(project.outputPath, html);

  return {
    outputPath: project.outputPath,
    sourceCount: project.sourceCount,
    watchFiles: project.watchFiles,
  };
}

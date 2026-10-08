<p align="center">
  <img src="assets/logo.svg" alt="mdo logo" width="120" height="120">
</p>

<h1 align="center">mdo</h1>
<p align="center"><strong>Markdown Document Office</strong> - turn Markdown into branded PDFs and presentations from the terminal</p>

---

<!-- mtoc-start -->

* [Why mdo?](#why-mdo)
* [What is mdo?](#what-is-mdo)
* [Installation](#installation)
  * [Uninstalling](#uninstalling)
  * [From source (for development)](#from-source-for-development)
* [Usage](#usage)
* [Configuration](#configuration)
  * [mdo-config.json](#mdo-configjson)
  * [Logo](#logo)
  * [YAML front matter](#yaml-front-matter)
  * [Multi-file documents](#multi-file-documents)
* [PDF](#pdf)
  * [PDF options](#pdf-options)
  * [PDF examples](#pdf-examples)
  * [Template resolution](#template-resolution)
  * [Frontpage placeholders](#frontpage-placeholders)
* [Slides](#slides)
  * [Slide options](#slide-options)
  * [Slides as PDF](#slides-as-pdf)
  * [Slide structure](#slide-structure)
  * [Slide attributes](#slide-attributes)
  * [Slide navigation](#slide-navigation)
  * [Slide examples](#slide-examples)
  * [Slide styling](#slide-styling)

<!-- mtoc-end -->

## Why mdo?

<p align="center">
  <img src="assets/illustration.svg?v=2" alt="The old way: knowledge scattered across presentation formats. The mdo way: markdown as single source of truth, generating PDFs and slides." width="720">
</p>

Teams build knowledge in formats optimized for editing and collaboration, then need to produce polished documents and presentations to share with others. Tools like the Microsoft or Google suites blur these two stages: people end up collaborating in a PowerPoint deck, and key knowledge gets left in various presentations in various versions rather than kept centrally.

These formats (pptx, docx, etc.) also aren't text-based, making them unfriendly to git and LLMs.

mdo separates editing from presentation:

* **Editing** - collaborate on Markdown files in whatever tools you like, with git for versioning and diffs.
* **Presentation** - generate customizable PDFs and slide decks from those same Markdown sources.

## What is mdo?

A CLI tool that converts Markdown into branded PDFs and presentations. It uses `pandoc` and `typst` for PDFs, and [Astro](https://astro.build) for slide decks, giving you access to the full power of HTML and CSS for visuals and animations.

mdo supports one-shot generation and a watch mode that re-renders as you edit. Both outputs can be produced from the same source.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/PineGrove-AI/MarkdownOffice/main/install.sh | bash
```

This will:

1. Check for `pandoc` and `typst`, offering to install them if missing
2. Download the latest `mdo` binary for your platform
3. Install it to `~/.local/bin`

### Uninstalling

```bash
mdo uninstall
```

This lists what will be removed and asks for confirmation:

* the `mdo` binary
* the cache in `~/.cache/mdo/` (Astro runtime, generated slide decks, downloaded browser)
* the global config in `~/.config/mdo/`, unless you pass `--keep-config`

Pass `--yes` to skip the prompt. Project-level `mdo-config.json` and logo files are left alone, and `pandoc` and `typst` are not removed.

### From source (for development)

Requires [Deno](https://deno.land):

```bash
deno task mdo pdf path/to/file.md
```

To compile a binary locally:

```bash
deno task compile
```

## Usage

```bash
mdo pdf <file-or-dir> [options]       # convert markdown to PDF
mdo slides <file-or-dir> [options]    # convert markdown to an HTML slide deck
mdo init [--global]                   # scaffold config and sample files
mdo update                            # update to the latest version
mdo uninstall [--yes] [--keep-config] # remove mdo, its cache and global config
mdo --version                         # print version
```

## Configuration

`mdo` looks for `mdo-config.json` and a logo file in the following order:

1. **Project root** - the directory you run `mdo` from (or specify with `--root`)
2. **Global config** - `~/.config/mdo/` (or `$XDG_CONFIG_HOME/mdo/`)

The first match wins. `mdo` prints which config file it's using on each run.

If neither exists, the first run creates a **placeholder** global config and `logo.svg` in `~/.config/mdo/` so you get a working document right away. The placeholders are deliberately loud (magenta branding, a "YOUR LOGO" logo and a "Placeholder branding" label) so you know to replace them.

You can also create them yourself:

```bash
mdo init --global   # ~/.config/mdo/mdo-config.json + logo.svg
mdo init            # ./mdo-config.json + logo.svg + example.md
```

Then edit `mdo-config.json` and replace `logo.svg` with your own `logo.png` or `logo.svg`.

### mdo-config.json

```json
{
  "company_name_prefix": "Your",
  "company_name_highlight": "Company",
  "brand_color": "#2563EB"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `company_name_prefix` | Yes | First part of the company name |
| `company_name_highlight` | Yes | Second part, rendered in `brand_color` |
| `brand_color` | Yes | Hex colour for branding accents |

The company name is rendered as `<prefix><highlight>` with the highlight portion colored using `brand_color`.

### Logo

Place a `logo.png` or `logo.svg` alongside your `mdo-config.json` (project root or global config dir). `logo.png` takes priority over `logo.svg`.

### YAML front matter

Each Markdown file can have a front matter block:

```yaml
---
doc-title: "Your Document Title"
doc-subtitle: "Optional subtitle"
---
```

| Field | Required | Description |
| --- | --- | --- |
| `doc-title` | Yes | Document title shown on the PDF frontpage and slide title slide |
| `doc-subtitle` | No | Subtitle below the title |

### Multi-file documents

Documents can pull in other files with `!include`:

```markdown
---
doc-title: "My Report"
doc-subtitle: "2026"
---

!include chapters/01-intro.md
!include chapters/02-analysis.md
```

Paths are relative to the including file. Includes are expanded recursively (up to 16 levels deep) before pandoc processes anything, so cross-chapter links work as if everything were in a single file.

`!include` lines inside fenced code blocks are left alone, so you can show them as examples. An included `.html` file is inserted as a raw HTML block, which is handy for keeping slide diagrams out of the Markdown (`!include diagrams/architecture.html`). Image paths inside included files resolve relative to the main document.

## PDF

`mdo pdf` converts Markdown to PDF using `pandoc` and `typst`.

When given a directory, `mdo pdf` merges all `.md` files in that directory (sorted alphabetically) into a single PDF.

### PDF options

| Flag | Description |
| --- | --- |
| `--watch`, `-w` | Re-render on file changes and open the PDF |
| `--open` | Open the PDF after rendering |
| `--output`, `-o` | Output PDF path (default: `<input>.pdf`) |
| `--root` | Document root for mdo-config.json and logo (default: cwd) |

PDF-specific front matter fields:

| Field | Required | Description |
| --- | --- | --- |
| `toc` | No | Set to `true` to include a table of contents |

PDF-specific config in `mdo-config.json`:

| Field | Required | Description |
| --- | --- | --- |
| `confidentiality_label` | No | Label shown on the PDF frontpage |
| `toc_depth` | No | Max heading depth for the table of contents (1-6, default `3`) |

### PDF examples

```bash
mdo pdf report.md                     # render a single file
mdo pdf report.md --open              # render and open the PDF
mdo pdf report.md --watch             # render, open, and re-render on changes
mdo pdf report.md --output build/out.pdf
mdo pdf reports/                      # merge all .md files in dir into one PDF
mdo pdf report.md --root /path/to/repo
```

### Template resolution

`mdo` ships with default templates for the frontpage layout and typst styling. These can be overridden per-project by placing files with the same name in the document root:

| Template | Purpose |
| --- | --- |
| `frontpage.typ` | Frontpage layout with placeholder tokens |
| `typst-header.typ` | Typst `#show` and `#set` rules for headings, lists, tables |

**Resolution order:** document root first, then the bundled defaults compiled into the binary. If a file exists in the document root, it takes priority.

### Frontpage placeholders

Custom `frontpage.typ` templates can use these tokens, which are substituted at build time:

| Placeholder | Source |
| --- | --- |
| `%%COMPANY_PREFIX%%` | `mdo-config.json` |
| `%%COMPANY_HIGHLIGHT%%` | `mdo-config.json` |
| `%%BRAND_COLOR%%` | `mdo-config.json` |
| `%%CONFIDENTIALITY%%` | `mdo-config.json` |
| `%%LOGO_PATH%%` | Resolved absolute path to logo file |
| `%%TITLE%%` | Document front matter |
| `%%SUBTITLE%%` | Document front matter |

## Slides

`mdo slides` turns Markdown into an [Astro](https://astro.build) slide deck and builds it into a single, self-contained HTML file (styles, scripts, logo and images inlined). Slides are full-screen, scroll-snapped sections with step-through reveals, a reveal counter, and your branding in the header and footer.

Slides need **Node.js (>= 18.17) and npm** in addition to pandoc. On first use, `mdo` installs Astro once into `~/.cache/mdo/astro/` (or `$XDG_CACHE_HOME/mdo/astro/`); each deck gets a generated Astro project there, under `decks/`.

### Slide options

| Flag | Description |
| --- | --- |
| `--watch`, `-w` | Serve the deck with the Astro dev server, open it, and live-reload on changes |
| `--open` | Open the presentation (or, with `--pdf`, the PDF) after rendering |
| `--output`, `-o` | Output HTML path (default: `<input>.html`) |
| `--pdf` | Also print the deck to a PDF next to the HTML (`<output>.pdf`). Can't be combined with `--watch` |
| `--root` | Document root for mdo-config.json and logo (default: cwd) |

### Slides as PDF

`mdo slides deck.md --pdf` builds the HTML deck as usual, then prints it to `deck.pdf` in a headless browser: one 16:9 page per slide, showing each slide's final state. Every reveal step is visible, and `reveal-dismiss` blocks are left out because they collapse before the slide ends.

Printing needs a Chromium-based browser. `mdo` uses, in order:

1. `$MDO_BROWSER`, if set, as the path to a Chrome/Chromium executable
2. an installed Google Chrome, Chromium, Microsoft Edge or Brave
3. Google's `chrome-headless-shell`, downloaded once into `~/.cache/mdo/browsers/` (via `npx @puppeteer/browsers`, so it works on CI and servers without a desktop browser)

The deck loads its fonts from Google Fonts, so print while online to get the right fonts.

### Slide structure

Slides are split at these boundaries:

* **`# Heading 1`** - starts a new section slide
* **`## Heading 2`** - starts a sub-slide (the parent `#` heading is shown as the eyebrow above the title)
* **`---`** (horizontal rule) - continuation slide within the current slide

If a document has no `#` headings (say, a README whose title is raw HTML), its highest heading level takes the place of `#`, and the next level down makes sub-slides.

Within a slide:

* A short paragraph (up to 140 characters) **directly after the heading** becomes the subtitle, followed by a divider rule and the rest of the content.
* `*emphasis*` in a heading is rendered in the brand colour, e.g. `# Who *are we?*`.
* A heading with nothing below it but a subtitle (e.g. `# Questions*?*`) is centred.
* `. . .` on its own line is a pause: everything after it is revealed on the next step.
* Lists inside `::: incremental` (or every list, with `incremental: true` in the front matter) reveal one item at a time. `::: nonincremental` opts back out.
* `::: reveal` reveals each child block of the div in turn.
* `:::: columns` with `::: column` children lays content out side by side, top-aligned (`:::: {.columns .center}` centres them vertically).
* Fenced divs stack their children with the standard gap; add `{.stack-tight}` or `{.stack-loose}` for tighter or looser spacing.
* `::: notes` holds speaker notes, which are never shown.
* Raw HTML in a ```` ```{=html} ```` block is passed through untouched, for diagrams, SVGs or custom layouts. The Markdown content styles don't apply inside it, but the design's classes (`.reveal`, `.stack`, `.body`, `.eyebrow`, ...) and theme variables (`var(--brand)`, `var(--ink-2)`, ...) do. Local images in `<img src>` and SVG `<image href>` are embedded like Markdown images. Longer HTML can live in its own file: `!include diagram.html` inserts it as a raw HTML block.
* `> blockquotes` render as call-outs; code blocks, tables and images are styled to match.

Content before the first `#` heading is ignored - the title slide is generated automatically from the front matter and branding config, and left out when the document has no `doc-title` or `doc-subtitle`.

### Slide attributes

Pandoc attributes on a `#`/`##` heading control that slide. `##` sub-slides and `---` continuations inherit `.dark`/`.cream` from their parent.

| Attribute | Effect |
| --- | --- |
| `{.dark}` | Dark background |
| `{.cream}` | Cream background (default is off-white paper) |
| `{.cover}` | Title-slide layout - useful for a closing slide |
| `{.center}` | Centre the title and content |
| `{.no-rule}` | No divider between the title and the content |
| `{.no-subtitle}` | Keep the first paragraph as regular content |
| `{eyebrow="..."}` | Small label above the title |
| `{label="..."}` | Text in the top-right corner (default: the `#` section title) |
| `{left="..." right="..."}` | Bottom corner text on `.cover` slides |

```markdown
---
doc-title: "Self-Hosted AI in *Production*"
doc-subtitle: "An afternoon with PineGrove AI"
cover-label: "Workshop"
cover-left: "90 min"
cover-right: "example.com"
---

# Welcome and *thanks for joining!* {.cream label="Welcome"}

Here's what we've got for you today

::: incremental
- **Part 1**: Introduction and background
- **Part 2**: Live building session
:::

. . .

Please ask questions throughout!

# Getting to know *you* {.dark}

## The AI *stack* {eyebrow="The moving parts"}

A paragraph, a list, a table...

---

Continued on the next slide.

# Questions*?* {.dark label="Q&A"}

About anything we covered today.

# Thanks for joining. {.cover label="Closing" left="contact@example.com"}
```

Slide-specific front matter fields (in addition to `doc-title` and `doc-subtitle`):

| Field | Description |
| --- | --- |
| `cover-label` | Top-right text on the title slide |
| `cover-left` / `cover-right` | Bottom corner text on the title slide |
| `incremental` | `true` to reveal every list item by item |

### Slide navigation

| Input | Action |
| --- | --- |
| Right / Down / Space / Click | Reveal the next step, then go to the next slide |
| Left / Up | Hide the last revealed step, then go to the previous slide |
| Scroll | Move between slides |
| `?noReveal=true` in the URL | Show every step at once |
| Ctrl+P | Print one 16:9 slide per page, as with `--pdf` |

### Slide examples

```bash
mdo slides deck.md --open                     # render and open
mdo slides deck.md --watch                    # live-reload dev server while editing
mdo slides deck.md --pdf                      # also print deck.pdf, one slide per page
mdo slides presentations/                     # merge a directory of .md files
mdo slides deck.md --output build/slides.html
```

### Slide styling

By default slides use the brand colour from `mdo-config.json` for accents, together with the company name and logo, on a neutral green-tinted palette. Every other colour, and the fonts, can be set with an optional `slides_theme` object in `mdo-config.json`:

```json
{
  "brand_color": "#1D4ED8",
  "slides_theme": {
    "background_dark": "#0F172A",
    "background_cover": "linear-gradient(135deg, #1E3A8A, #0F172A)",
    "text_on_dark": "#E0F2FE",
    "accent": "#60A5FA",
    "font": "Space Grotesk",
    "mono_font": "IBM Plex Mono"
  }
}
```

| Key | Used for | Default |
| --- | --- | --- |
| `background` | Default slides | `#FBFAF7` |
| `background_cream` | `{.cream}` slides, code blocks | `#F6F2ED` |
| `background_dark` | `{.dark}` slides | `#2B413A` |
| `background_cover` | Title slide and `{.cover}` slides | same as `background_dark` |
| `backdrop` | Page behind the slides | `#0D0F0E` |
| `text` | Titles | `#1A2622` |
| `text_secondary` | Subtitles, bold text | `#2B413A` |
| `text_muted` | Body text, header and footer | `#4D6459` |
| `text_on_dark` | Text on dark and cover slides (faded variants are derived from it) | `#F6F2ED` |
| `accent_deep` | Accent on light slides (highlighted title words, bullets, links) | `brand_color` |
| `accent` | Accent on dark slides and in the wordmark | a lighter shade of `accent_deep` |
| `callout` | Blockquote border | `#7A512E` |
| `line` | Table rows, code block borders | `#E4DFD5` |
| `rule` | Divider under slide titles | `#C9C3B6` |
| `font` | All text except the monospace labels | `Inter` |
| `mono_font` | Header, footer, eyebrows, code and table headings | `JetBrains Mono` |

Backgrounds accept any CSS background value, so gradients work too.

`font` and `mono_font` take a [Google Fonts](https://fonts.google.com) family name (`"Lora"`), which is loaded automatically when the deck is opened, or a full CSS font stack (`"Lora, Georgia, serif"`), whose first font is loaded from Google Fonts. A font that isn't on Google Fonts gets a warning at build time and only shows on machines where it's installed. Like the defaults, fonts are loaded online and aren't embedded in the HTML. Unknown keys are rejected with a list of valid ones. Keys starting with `--` set a raw CSS custom property, which is handy together with `slides.css`.

For anything beyond that, place a `slides.css` in the document root. It is loaded after the built-in styles.

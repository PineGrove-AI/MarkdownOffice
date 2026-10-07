import { resolve } from "jsr:@std/path";
import { prepareSlidesProject, renderSlides } from "../lib/render-slides.ts";
import { astroDev, ensureAstroRuntime } from "../lib/astro.ts";
import { printToPdf } from "../lib/browser.ts";
import * as ui from "../lib/ui.ts";

/** Open a file with the system default application. */
async function openFile(path: string): Promise<void> {
  const abs = resolve(path);
  const cmd = Deno.build.os === "darwin"
    ? new Deno.Command("open", { args: [abs] })
    : new Deno.Command("xdg-open", { args: [abs] });
  await cmd.output();
}

export interface SlidesArgs {
  input: string;
  output?: string;
  watch: boolean;
  open: boolean;
  /** Also print the deck to a PDF next to the HTML output */
  pdf: boolean;
  rootDir: string;
}

export async function slidesCommand(args: SlidesArgs): Promise<void> {
  const renderOpts = {
    input: args.input,
    output: args.output,
    rootDir: args.rootDir,
  };

  if (!args.watch) {
    // ── One-shot render ───────────────────────────────────────────────
    const startedAt = performance.now();
    const result = await renderSlides(renderOpts);
    await ui.generated(result.outputPath, startedAt, result.sourceCount);

    let openPath = result.outputPath;
    if (args.pdf) {
      const pdfStartedAt = performance.now();
      const pdfPath = result.outputPath.replace(/\.html?$/i, "") + ".pdf";
      await ui.step("Printing slides to PDF", () => printToPdf(result.outputPath, pdfPath));
      await ui.generated(pdfPath, pdfStartedAt);
      openPath = pdfPath;
    }

    if (args.open) {
      await openFile(openPath);
    }
    return;
  }

  // ── Watch mode: Astro dev server with live reload ───────────────────
  await ensureAstroRuntime();
  const project = await prepareSlidesProject(renderOpts, "dev");
  ui.info(`Astro project: ${ui.dim(ui.tidyPath(project.projectDir))}`);

  const server = astroDev(project.projectDir, project.assetDir, true);
  server.status.then(({ code }) => Deno.exit(code));

  const watchPaths = [...new Set(project.watchFiles)];
  ui.watching(watchPaths.length);

  const watcher = Deno.watchFs(watchPaths);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  for await (const event of watcher) {
    const hasChange = event.paths.some((p) => /\.(md|css|html?)$/.test(p));
    if (!hasChange) continue;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      ui.changed(event.paths);
      try {
        await prepareSlidesProject(renderOpts, "dev");
        ui.success("Slides updated, the browser reloads by itself");
      } catch (e) {
        ui.error(`Build failed: ${(e as Error).message}`);
      }
    }, 300);
  }
}

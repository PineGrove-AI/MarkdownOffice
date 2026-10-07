import { resolve } from "jsr:@std/path";
import { renderPdf } from "../lib/render.ts";
import * as ui from "../lib/ui.ts";

/** Open a file with the system default application. */
async function openFile(path: string): Promise<void> {
  const abs = resolve(path);
  const cmd = Deno.build.os === "darwin"
    ? new Deno.Command("open", { args: [abs] })
    : new Deno.Command("xdg-open", { args: [abs] });
  await cmd.output();
}

export interface PdfArgs {
  input: string;
  output?: string;
  watch: boolean;
  open: boolean;
  rootDir: string;
}

export async function pdfCommand(args: PdfArgs): Promise<void> {
  // ── One-shot render ─────────────────────────────────────────────────
  const startedAt = performance.now();
  const result = await renderPdf({
    input: args.input,
    output: args.output,
    rootDir: args.rootDir,
  });

  await ui.generated(result.outputPath, startedAt, result.sourceCount);

  if (args.open || args.watch) {
    await openFile(result.outputPath);
  }

  if (!args.watch) return;

  // ── Watch mode ──────────────────────────────────────────────────────
  const watchPaths = [...new Set(result.watchFiles)];
  ui.watching(watchPaths.length);

  const watcher = Deno.watchFs(watchPaths);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  for await (const event of watcher) {
    // Only react to modifications of .md files
    const hasMdChange = event.paths.some((p) => p.endsWith(".md"));
    if (!hasMdChange) continue;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      ui.changed(event.paths);
      const startedAt = performance.now();
      try {
        const r = await renderPdf({
          input: args.input,
          output: args.output,
          rootDir: args.rootDir,
        });
        await ui.generated(r.outputPath, startedAt, r.sourceCount);
      } catch (e) {
        ui.error(`Build failed: ${(e as Error).message}`);
      }
    }, 300);
  }
}

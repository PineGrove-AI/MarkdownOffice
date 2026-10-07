import { resolve } from "jsr:@std/path";
import { pdfCommand } from "./commands/pdf.ts";
import { slidesCommand } from "./commands/slides.ts";
import { initCommand } from "./commands/init.ts";
import { uninstallCommand } from "./commands/uninstall.ts";
import { updateCommand } from "./lib/update.ts";
import { version } from "./lib/version.ts";
import * as ui from "./lib/ui.ts";

function printUsage(): void {
  console.log(`mdo — markdown document office (${version})

Usage:
  mdo pdf <file-or-dir> [options]    Convert markdown to PDF
  mdo slides <file-or-dir> [options] Convert markdown to an HTML slide deck (Astro)
  mdo init [--global]                Create mdo-config.json and sample files
  mdo update                         Update to the latest version
  mdo uninstall [options]            Remove mdo, its cache and global config

Options (pdf & slides):
  --watch, -w      Re-render on file changes and open the output
                   (slides: live-reloading Astro dev server)
  --open           Open the output after rendering
  --output, -o     Output path (default: <input>.pdf / <input>.html)
  --root           Document root for mdo-config.json and logo (default: cwd)
  --pdf            (slides) Also print the deck to <output>.pdf, one slide
                   per page (uses Chrome/Chromium; downloads one if needed)

Options (uninstall):
  --yes, -y        Don't ask for confirmation
  --keep-config    Keep the global config (branding and logo)

Global options:
  --version, -v    Print version
  --help, -h       Print this help

Examples:
  mdo init                           # set up mdo-config.json in current dir
  mdo init --global                  # set up global config in ~/.config/mdo/
  mdo pdf report.md
  mdo pdf report.md --watch
  mdo pdf report.md --open
  mdo pdf reports/ --output out.pdf
  mdo slides deck.md --open
  mdo slides deck.md --watch
  mdo slides deck.md --pdf`);
}

/** Run a command, turning a thrown error into a tidy message and exit code 1. */
function run(task: Promise<void>): void {
  task.catch((e) => {
    ui.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  });
}

function parseArgs(args: string[]): void {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    Deno.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(`mdo ${version}`);
    Deno.exit(0);
  }

  const command = args[0];

  if (command === "update") {
    run(updateCommand());
    return;
  }

  if (command === "uninstall") {
    const rest = args.slice(1);
    const unknown = rest.find((a) => !["--yes", "-y", "--keep-config"].includes(a));
    if (unknown) {
      console.error(`Unknown option: ${unknown}`);
      Deno.exit(1);
    }
    run(uninstallCommand({
      yes: rest.includes("--yes") || rest.includes("-y"),
      keepConfig: rest.includes("--keep-config"),
    }));
    return;
  }

  if (command === "init") {
    const global = args.includes("--global");
    run(initCommand({ global }));
    return;
  }

  if (command === "pdf" || command === "slides") {
    const rest = args.slice(1);
    let input: string | undefined;
    let output: string | undefined;
    let watch = false;
    let open = false;
    let pdf = false;
    let rootDir = Deno.cwd();

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--watch" || arg === "-w") {
        watch = true;
      } else if (arg === "--open") {
        open = true;
      } else if (arg === "--pdf" && command === "slides") {
        pdf = true;
      } else if (arg === "--output" || arg === "-o") {
        output = rest[++i];
        if (!output) {
          console.error("Error: --output requires a path");
          Deno.exit(1);
        }
      } else if (arg === "--root") {
        rootDir = resolve(rest[++i]);
        if (!rootDir) {
          console.error("Error: --root requires a path");
          Deno.exit(1);
        }
      } else if (arg.startsWith("-")) {
        console.error(`Unknown option: ${arg}`);
        Deno.exit(1);
      } else {
        input = arg;
      }
    }

    if (!input) {
      console.error(`Error: ${command} command requires an input file or directory`);
      printUsage();
      Deno.exit(1);
    }

    try {
      Deno.statSync(input);
    } catch {
      ui.error(`Input not found: ${input}`);
      Deno.exit(1);
    }

    if (command === "pdf") {
      run(pdfCommand({ input, output, watch, open, rootDir }));
    } else {
      if (pdf && watch) {
        console.error("Error: --pdf can't be combined with --watch");
        Deno.exit(1);
      }
      run(slidesCommand({ input, output, watch, open, pdf, rootDir }));
    }
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    Deno.exit(1);
  }
}

parseArgs(Deno.args);

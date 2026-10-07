import { basename } from "jsr:@std/path";
import { cacheDir } from "../lib/astro.ts";
import { globalConfigDir } from "../lib/config.ts";
import * as ui from "../lib/ui.ts";

export interface UninstallArgs {
  /** Skip the confirmation prompt */
  yes: boolean;
  /** Leave the global config (branding and logo) in place */
  keepConfig: boolean;
}

interface Target {
  path: string;
  label: string;
}

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false);
}

/** The installed mdo binary, or null when running through `deno run`. */
function installedBinary(): string | null {
  const exec = Deno.execPath();
  return /^deno(\.exe)?$/.test(basename(exec)) ? null : exec;
}

export async function uninstallCommand(args: UninstallArgs): Promise<void> {
  const targets: Target[] = [];

  const binary = installedBinary();
  if (binary) targets.push({ path: binary, label: "mdo binary" });

  const cache = cacheDir();
  if (await exists(cache)) {
    targets.push({ path: cache, label: "cache (Astro runtime, slide decks, downloaded browser)" });
  }

  const config = globalConfigDir();
  const hasConfig = await exists(config);
  if (hasConfig && !args.keepConfig) {
    targets.push({ path: config, label: "global config (your branding and logo)" });
  }

  if (targets.length === 0) {
    ui.info("Nothing to remove.");
    return;
  }

  ui.blank();
  ui.info("This will remove:");
  for (const t of targets) console.log(`      ${ui.bold(ui.tidyPath(t.path))}  ${ui.dim(t.label)}`);
  if (hasConfig && args.keepConfig) ui.info(`Keeping global config: ${ui.tidyPath(config)}`);
  if (!binary) ui.info("Running from source, so there is no installed binary to remove.");
  ui.blank();

  if (!args.yes) {
    if (!Deno.stdin.isTerminal()) {
      throw new Error("Not running interactively. Re-run with --yes to confirm.");
    }
    if (!confirm("  Continue?")) {
      ui.info("Aborted, nothing was removed.");
      return;
    }
  }

  let failures = 0;
  for (const t of targets) {
    try {
      await Deno.remove(t.path, { recursive: true });
      ui.success(`removed ${ui.tidyPath(t.path)}`);
    } catch (err) {
      ui.error(`Failed to remove ${ui.tidyPath(t.path)}: ${err}`);
      failures++;
    }
  }

  ui.blank();
  ui.info(ui.dim("Project-level mdo-config.json and logo files were left alone."));
  ui.info(ui.dim("pandoc and typst were not removed, as other tools may use them."));

  if (failures > 0) Deno.exit(1);
  ui.blank();
  ui.success("mdo has been uninstalled. Thanks for trying it!");
  ui.blank();
}

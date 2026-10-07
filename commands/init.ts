import { join } from "jsr:@std/path";
import { globalConfigDir } from "../lib/config.ts";
import { writeIfMissing, writeSampleConfig } from "../lib/sample-config.ts";
import * as ui from "../lib/ui.ts";

const SAMPLE_DOC = `---
doc-title: "My Document"
doc-subtitle: "Subtitle"
toc: true
---

# Introduction

Start writing here.
`;

export interface InitArgs {
  global: boolean;
}

export async function initCommand(args: InitArgs): Promise<void> {
  const targetDir = args.global ? globalConfigDir() : Deno.cwd();

  ui.blank();
  ui.info(`Initializing mdo in ${ui.bold(ui.tidyPath(targetDir))}`);

  const created = await writeSampleConfig(targetDir);

  if (!args.global && await writeIfMissing(join(targetDir, "example.md"), SAMPLE_DOC)) {
    created.push(join(targetDir, "example.md"));
  }

  for (const path of created) ui.success(`created ${ui.tidyPath(path)}`);
  if (created.length === 0) ui.info("Nothing to do, all files already exist");

  ui.blank();
  ui.warn(`The config and logo.svg are placeholders (${ui.hex("#FF00FF", "magenta")}, "YOUR LOGO").`);
  ui.info(`Edit mdo-config.json and replace logo.svg with your own logo.png or logo.svg.`);
  if (!args.global) ui.info(`Then run ${ui.bold("mdo pdf example.md")}`);
  ui.blank();
}

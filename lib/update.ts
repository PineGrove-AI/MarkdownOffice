import { version } from "./version.ts";
import * as ui from "./ui.ts";

const REPO = "PineGrove-AI/MarkdownOffice";

interface GitHubRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

function detectPlatform(): string {
  const os = Deno.build.os === "darwin" ? "darwin" : "linux";
  const arch = Deno.build.arch === "x86_64" ? "x86_64" : "aarch64";
  return `${os}-${arch}`;
}

/** Compare two semver strings (v-prefix optional). Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, "").split(".").map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export async function updateCommand(): Promise<void> {
  ui.info(`Current version: ${ui.bold(version)}`);

  if (version === "dev") {
    throw new Error("Cannot update a development build. Install from a release binary first.");
  }

  let release: GitHubRelease;
  try {
    release = await ui.step("Checking for updates", async () => {
      const resp = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
      );
      if (!resp.ok) {
        throw new Error(`GitHub API returned ${resp.status}`);
      }
      return await resp.json();
    });
  } catch (err) {
    throw new Error(`Failed to check for updates: ${err}`);
  }

  const latest = release.tag_name;

  if (compareSemver(latest, version) <= 0) {
    ui.success(`Already up to date (${version}).`);
    return;
  }

  ui.info(`New version available: ${ui.bold(ui.green(latest))}`);

  const platform = detectPlatform();
  const artifactName = `mdo-${platform}`;
  const asset = release.assets.find((a) => a.name === artifactName);

  if (!asset) {
    throw new Error(
      `No binary found for ${platform} in release ${latest}. Check https://github.com/${REPO}/releases`,
    );
  }

  const binary = await ui.step(`Downloading ${artifactName}`, async () => {
    const resp = await fetch(asset.browser_download_url);
    if (!resp.ok) {
      throw new Error(`Download failed: ${resp.status}`);
    }
    return new Uint8Array(await resp.arrayBuffer());
  });

  // Find where the current binary is installed
  const currentBinary = Deno.execPath();

  // Write to a temp file next to the binary, then rename (atomic-ish)
  const tmpPath = `${currentBinary}.update`;
  try {
    await Deno.writeFile(tmpPath, binary, { mode: 0o755 });
    await Deno.rename(tmpPath, currentBinary);
  } catch (err) {
    // Clean up temp file on failure
    await Deno.remove(tmpPath).catch(() => {});
    throw new Error(`Failed to replace binary at ${currentBinary}: ${err}`);
  }

  ui.success(`Updated to ${ui.bold(latest)}.`);
}

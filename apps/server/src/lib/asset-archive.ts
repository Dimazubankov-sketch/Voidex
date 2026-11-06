import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Keeps the hashed `/assets/*` files of the last few releases.
 *
 * Why: a deployment replaces the image's `/assets`, but a page opened before the deployment (an open tab, a
 * home-screen app resumed from the background) still asks for chunks of ITS build. Without them the person
 * meets a failed import. With the archive those requests are still answered (files are immutable: the name is
 * the content hash), and the page moves to the new build later, when it is safe.
 *
 * Layout inside `archiveDir` (a persistent volume):
 *   files/<name>            every archived asset (name = content hash, so one copy serves all releases)
 *   releases/<build>.json   {"build", "files":[…], "at": ms}  — which files that release used
 * Pruning drops releases beyond `keep` (newest by `at`), then files no remaining release references.
 *
 * Never throws: an unwritable volume only means "no archive" (logged by the caller).
 */

const SAFE_NAME = /^[A-Za-z0-9._-]{1,200}$/;
const SAFE_BUILD = /^[A-Za-z0-9._-]{1,100}$/;

export interface ArchiveResult {
  build: string;
  added: number;
  kept: number;
  releases: number;
  removedFiles: number;
}

export function archiveAssets(opts: { distDir: string; archiveDir: string; build: string; keep: number; now?: number }): ArchiveResult {
  const { distDir, archiveDir, build, keep } = opts;
  if (!SAFE_BUILD.test(build)) throw new Error("unsafe build id");
  const assets = join(distDir, "assets");
  const files = join(archiveDir, "files");
  const releases = join(archiveDir, "releases");
  mkdirSync(files, { recursive: true });
  mkdirSync(releases, { recursive: true });

  const names = existsSync(assets) ? readdirSync(assets).filter((n) => SAFE_NAME.test(n) && !n.endsWith(".map") && statSync(join(assets, n)).isFile()) : [];
  let added = 0;
  for (const n of names) {
    const dest = join(files, n);
    if (existsSync(dest)) continue;
    // Copy to a temp name and rename: a crash mid-copy never leaves a truncated file under the real name.
    const tmp = `${dest}.tmp-${process.pid}`;
    copyFileSync(join(assets, n), tmp);
    renameSync(tmp, dest);
    added++;
  }
  writeFileSync(join(releases, `${build}.json`), JSON.stringify({ build, files: names, at: opts.now ?? Date.now() }));

  // Prune: newest `keep` releases survive; the current build is always one of them.
  const all = readdirSync(releases)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(readFileSync(join(releases, f), "utf8")) as { build: string; files: string[]; at: number };
        return { file: f, build: r.build, files: Array.isArray(r.files) ? r.files : [], at: Number(r.at) || 0 };
      } catch {
        return { file: f, build: f, files: [] as string[], at: 0 };
      }
    })
    .sort((a, b) => b.at - a.at);
  const survivors = all.filter((r, i) => i < keep || r.build === build);
  for (const r of all) if (!survivors.includes(r)) rmSync(join(releases, r.file), { force: true });
  const referenced = new Set(survivors.flatMap((r) => r.files));
  let removedFiles = 0;
  for (const n of readdirSync(files)) {
    if (!referenced.has(n) && !n.includes(".tmp-")) {
      rmSync(join(files, n), { force: true });
      removedFiles++;
    }
  }
  return { build, added, kept: referenced.size, releases: survivors.length, removedFiles };
}

/** `/assets/<name>` → the archived file's name, or null (unsafe path, or not archived). */
export function archivedAsset(archiveDir: string, urlPath: string): string | null {
  const path = urlPath.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/assets/")) return null;
  const name = path.slice("/assets/".length);
  if (!SAFE_NAME.test(name)) return null; // no slashes, no "..", nothing but file-name characters
  return existsSync(join(archiveDir, "files", name)) ? name : null;
}

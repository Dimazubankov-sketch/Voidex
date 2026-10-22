/**
 * Cache rules for the built web client (A1: "a normal reload must show the new version").
 *
 * - `/assets/*` files carry a content hash in their name, so they never change: cached for a year.
 * - `index.html` (and the SPA routes that return it), `version.json`, the manifest and the boot guard
 *   are revalidated on every load (`no-cache` = "ask the server first", the ETag makes that a cheap 304).
 * - Everything else in `public/` (icons, wallpapers, store art) keeps a short cache.
 */
export function webCacheControl(filePath: string): string {
  const p = filePath.replace(/\\/g, "/");
  if (/(^|\/)assets\//.test(p)) return "public, max-age=31536000, immutable";
  if (/(^|\/)(index\.html|version\.json|manifest\.webmanifest|boot-guard\.js)$/.test(p)) return "no-cache";
  return "public, max-age=3600";
}

/**
 * Only page routes fall back to index.html. A missing hashed chunk (an old build asking for a file the new
 * image no longer has) must get a real 404: answering it with index.html makes Safari fail with
 * "expected a JavaScript module but got text/html" and leaves a blank screen instead of a recoverable error.
 */
export function isSpaRoute(url: string): boolean {
  const path = url.split(/[?#]/)[0] ?? "/";
  if (path.startsWith("/api/") || path === "/api") return false;
  if (path.startsWith("/assets/")) return false;
  // Update 2 · C6: profile links (/u/<username>) are pages, even when a username has a dot in it.
  if (/^\/u\/[^/]+\/?$/.test(path)) return true;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !/\.[a-z0-9]{1,8}$/i.test(last);
}

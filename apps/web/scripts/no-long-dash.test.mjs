/**
 * Product copy has no long dash "—" (Step 2.7). Checks every string the
 * interface can show: the dictionaries, string and template literals and
 * JSX text of the web app and of the Files / Media modules. Comments are not
 * code, so they are not checked; nor are docs, tests or user content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const DIRS = ["apps/web/src", "packages/files/src", "packages/media/src"];
const DASH = "—";

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [p] : [];
  });
}

function offenders(path) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(DASH)) return [];
  const src = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      node.text.includes(DASH)
    ) {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
      found.push(`${relative(root, path)}:${line + 1}: ${node.text.trim().slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

test("no long dash in product copy", () => {
  const all = DIRS.flatMap((d) => files(join(root, d))).flatMap(offenders);
  assert.deepEqual(all, [], `Use ":" or "," instead of "${DASH}" in:\n${all.join("\n")}`);
});

test("the check sees strings and JSX text but not comments", () => {
  const probe = join(root, "apps/web/scripts/.probe.tsx");
  const src = ts.createSourceFile(probe, `// a ${DASH} b\nconst x = <p>a ${DASH} b</p>;\nconst y = "c ${DASH} d";`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isJsxText(node)) && node.text.includes(DASH)) n++;
    ts.forEachChild(node, visit);
  };
  visit(src);
  assert.equal(n, 2);
});

/** Recompute from the starting snapshot, so dragging backwards shrinks the painted range. */
export function paintRange(ids: readonly string[], base: ReadonlySet<string>, anchor: number, end: number, remove: boolean): Set<string> {
  const next = new Set(base);
  for (let i = Math.min(anchor, end); i <= Math.max(anchor, end); i++) {
    const id = ids[i];
    if (!id) continue;
    if (remove) next.delete(id);
    else next.add(id);
  }
  return next;
}

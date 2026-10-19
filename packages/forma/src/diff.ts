import type { Backend, Binding, Frontend } from "./types.js";

/** A short, human-readable list of what changed between two versions of a layer. */
export function diffBackend(a: { backend: Backend; bindings: Binding[] }, b: { backend: Backend; bindings: Binding[] }): string[] {
  const out: string[] = [];
  const opsA = new Map(a.backend.operations.map((o) => [o.name, o]));
  const opsB = new Map(b.backend.operations.map((o) => [o.name, o]));
  for (const [name, o] of opsB) {
    const prev = opsA.get(name);
    if (!prev) out.push(`+ операция ${name}`);
    else if (JSON.stringify({ ...prev, updatedAt: 0, updatedBy: 0 }) !== JSON.stringify({ ...o, updatedAt: 0, updatedBy: 0 })) {
      const parts: string[] = [];
      if (prev.handler.source !== o.handler.source) parts.push("код");
      if (JSON.stringify(prev.input) !== JSON.stringify(o.input)) parts.push("вход");
      if (JSON.stringify(prev.output) !== JSON.stringify(o.output)) parts.push("ответ");
      if (JSON.stringify(prev.tests) !== JSON.stringify(o.tests)) parts.push("тесты");
      if (JSON.stringify(prev.errors) !== JSON.stringify(o.errors)) parts.push("ошибки");
      if (prev.description !== o.description) parts.push("описание");
      out.push(`~ операция ${name}${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }
  }
  for (const name of opsA.keys()) if (!opsB.has(name)) out.push(`- операция ${name}`);
  const bA = new Map(a.bindings.map((x) => [x.id, x]));
  const bB = new Map(b.bindings.map((x) => [x.id, x]));
  for (const [bid, x] of bB) {
    const prev = bA.get(bid);
    if (!prev) out.push(`+ привязка ${x.elementId}.${x.event} -> ${x.operation}`);
    else if (JSON.stringify(prev) !== JSON.stringify(x)) out.push(`~ привязка ${x.elementId}.${x.event} -> ${x.operation}`);
  }
  for (const [bid, x] of bA) if (!bB.has(bid)) out.push(`- привязка ${x.elementId}.${x.event} -> ${x.operation}`);
  return out;
}

export function diffFrontend(a: { name: string; frontend: Frontend }, b: { name: string; frontend: Frontend }): string[] {
  const out: string[] = [];
  if (a.name !== b.name) out.push(`~ название: ${b.name}`);
  const sa = new Map(a.frontend.screens.map((s) => [s.id, s]));
  const sb = new Map(b.frontend.screens.map((s) => [s.id, s]));
  for (const [sid, s] of sb) {
    const prev = sa.get(sid);
    if (!prev) {
      out.push(`+ экран ${s.name}`);
      continue;
    }
    const ea = new Map(prev.elements.map((e) => [e.id, e]));
    const eb = new Map(s.elements.map((e) => [e.id, e]));
    let added = 0;
    let removed = 0;
    let changed = 0;
    for (const [eid, e] of eb) {
      const pe = ea.get(eid);
      if (!pe) added++;
      else if (JSON.stringify(pe) !== JSON.stringify(e)) changed++;
    }
    for (const eid of ea.keys()) if (!eb.has(eid)) removed++;
    if (prev.name !== s.name || prev.background !== s.background || added || removed || changed) {
      const parts = [added && `+${added}`, removed && `-${removed}`, changed && `~${changed}`].filter(Boolean).join(" ");
      out.push(`~ экран ${s.name}${parts ? ` (элементы ${parts})` : ""}`);
    }
  }
  for (const [sid, s] of sa) if (!sb.has(sid)) out.push(`- экран ${s.name}`);
  if (JSON.stringify(a.frontend.shared) !== JSON.stringify(b.frontend.shared)) out.push("~ общие меню");
  if (a.frontend.resources.length !== b.frontend.resources.length) out.push(`~ звуки: ${b.frontend.resources.length}`);
  return out;
}

/**
 * What an AI agent connection may do. Every connection is bound to one
 * project; `project.read` is always included. Frontend writing is a separate,
 * explicit grant: by default an agent builds the backend and the bindings and
 * may only suggest interface changes.
 */
export const AGENT_SCOPES = ["project.read", "backend.write", "bindings.write", "tests.run", "frontend.write"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

export const SCOPE_LABELS: Record<AgentScope, { title: string; hint: string }> = {
  "project.read": { title: "Чтение проекта", hint: "Экраны, компоненты, события, контракты" },
  "backend.write": { title: "Backend", hint: "Создавать и менять серверные операции" },
  "bindings.write": { title: "Привязки", hint: "Связывать компоненты с операциями" },
  "tests.run": { title: "Проверки", hint: "Проверка контрактов и тесты" },
  "frontend.write": { title: "Интерфейс", hint: "Менять экраны и компоненты" },
};

export const DEFAULT_SCOPES: AgentScope[] = ["project.read", "backend.write", "bindings.write", "tests.run"];

export const AGENT_CLIENTS = ["claude-code", "chatgpt", "voidex-ai", "other"] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

export const CLIENT_LABELS: Record<AgentClient, string> = {
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  "voidex-ai": "Voidex AI",
  other: "Другой клиент",
};

/** Lifetimes a person can give a connection (hours). */
export const TOKEN_TTLS = [1, 24, 24 * 7, 24 * 30] as const;

export function isScope(v: unknown): v is AgentScope {
  return typeof v === "string" && (AGENT_SCOPES as readonly string[]).includes(v);
}

export function normalizeScopes(list: unknown): AgentScope[] {
  const set = new Set<AgentScope>(["project.read"]);
  if (Array.isArray(list)) for (const s of list) if (isScope(s)) set.add(s);
  return AGENT_SCOPES.filter((s) => set.has(s));
}

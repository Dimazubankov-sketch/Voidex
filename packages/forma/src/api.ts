import type { AgentClient, AgentScope } from "./permissions.js";
import type { Project } from "./types.js";

/** Wire types of the Forma API (`/api/forma`), shared by the server and the web app. */

export interface FormaProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  screens: number;
  operations: number;
  bindings: number;
  frontendRevision: number;
  backendRevision: number;
  /** For the project card: start screen colours and the first heading / button. */
  cover: { background: string; accent: string; title: string; button: string | null };
}

export interface FormaProjectDto {
  project: Project;
  frontendRevision: number;
  backendRevision: number;
}

export interface FormaSaveResult {
  frontendRevision: number;
  updatedAt: string;
}

export interface FormaRevisionDto {
  layer: "frontend" | "backend";
  revision: number;
  actor: "user" | "agent";
  agentName: string | null;
  summary: string[];
  createdAt: string;
}

export interface FormaAgentDto {
  id: string;
  name: string;
  client: AgentClient;
  scopes: AgentScope[];
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  active: boolean;
}

export interface FormaAgentCreated {
  agent: FormaAgentDto;
  /** Shown once; only its SHA-256 is stored. */
  token: string;
  endpoints: { rest: string; mcp: string; openapi: string };
}

export interface FormaAuditDto {
  id: string;
  actor: "user" | "agent";
  agentName: string | null;
  action: string;
  ok: boolean;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Error codes of the Forma API (besides the common Voidex ones). */
export const FORMA_ERRORS = {
  conflict: "forma_conflict",
  agentUnauthorized: "forma_agent_unauthorized",
  scope: "forma_scope_denied",
  backendReadOnly: "forma_backend_read_only",
  invalid: "forma_invalid",
  limit: "forma_limit",
} as const;

export const FORMA_LIMITS = {
  projectsPerAccount: 100,
  activeAgentsPerProject: 20,
} as const;

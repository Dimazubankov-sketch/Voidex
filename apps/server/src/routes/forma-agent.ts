import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { ErrorCode } from "@voidex/shared";
import { COMPONENT_TYPES, componentContract, findElement, findScreen, visibleElements, type AgentScope, type BackendCommand, type Command, type Project } from "@voidex/forma";
import { AppError } from "../lib/errors.js";
import { formaFail, type AgentContext, type FormaService } from "../services/forma.js";

/**
 * Forma agent API, version 1. One set of typed tools, served two ways:
 *
 *   REST  /api/forma/agent/v1/...   (ChatGPT actions via OpenAPI, scripts, Voidex AI)
 *   MCP   POST /api/forma/mcp       (Claude Code and other MCP clients; JSON-RPC 2.0,
 *                                    Streamable HTTP transport, JSON responses)
 *
 * Every call authenticates with a project-bound agent token
 * (`Authorization: Bearer fma_...`), is checked against the connection's
 * scopes and written to the project's audit log. Session tokens of people
 * are not accepted here, and agent tokens are not accepted anywhere else.
 */

type Json = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  scope: AgentScope;
  write: boolean;
  input: Json;
  run: (svc: FormaService, ctx: AgentContext, args: Json) => Promise<unknown>;
}

const int = (v: unknown, name: string) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw formaFail("forma_invalid", `${name} must be a non-negative integer.`, 400, { path: name });
  return n;
};
const text = (v: unknown, name: string, max = 200) => {
  if (typeof v !== "string" || !v || v.length > max) throw formaFail("forma_invalid", `${name} is required.`, 400, { path: name });
  return v;
};
const layerOf = (v: unknown) => (v === "frontend" ? "frontend" : "backend") as "frontend" | "backend";

const obj = (properties: Json, required: string[] = []): Json => ({ type: "object", properties, required, additionalProperties: false });
const BASE = { type: "integer", minimum: 0, description: "The revision of the layer you read (backendRevision / frontendRevision). A stale value is refused with 409." };

/** Compact tree of a screen: what an agent needs to wire a backend. */
function tree(p: Project, screenId: string) {
  const s = findScreen(p, screenId);
  if (!s) throw new AppError(ErrorCode.NotFound, "Screen not found.");
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    elements: visibleElements(p, s).map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      shared: p.frontend.shared.some((x) => x.id === e.id),
      props: e.props,
      events: e.events,
      bindings: p.bindings.filter((b) => b.elementId === e.id).map((b) => ({ id: b.id, event: b.event, operation: b.operation })),
      layouts: e.layouts,
    })),
  };
}

export const TOOLS: Tool[] = [
  {
    name: "forma_get_project",
    title: "Get project",
    description: "The whole project: frontend (screens, components, events, sounds), backend (operations with contracts and code), bindings, and the revision of each layer.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => svc.agentRead(ctx),
  },
  {
    name: "forma_get_info",
    title: "Project info",
    description: "Name, schema version, dates and the current frontend / backend revisions.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => {
      const d = await svc.agentRead(ctx);
      const p = d.project;
      return {
        id: p.id,
        name: p.name,
        schemaVersion: p.schemaVersion,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        frontendRevision: d.frontendRevision,
        backendRevision: d.backendRevision,
        runtime: p.backend.runtime,
        scopes: [...ctx.scopes],
      };
    },
  },
  {
    name: "forma_list_screens",
    title: "List screens",
    description: "Screens of the app with role, element count and screen events.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => {
      const p = (await svc.agentRead(ctx)).project;
      return p.frontend.screens.map((s) => ({ id: s.id, name: s.name, role: s.role, start: s.id === p.settings.startScreenId, elements: s.elements.length, events: s.events }));
    },
  },
  {
    name: "forma_get_screen_tree",
    title: "Screen component tree",
    description: "Components visible on a screen (its own and the shared menus): id, type, name, props, events, bindings, layouts per device.",
    scope: "project.read",
    write: false,
    input: obj({ screenId: { type: "string" } }, ["screenId"]),
    run: async (svc, ctx, a) => tree((await svc.agentRead(ctx)).project, text(a.screenId, "screenId", 80)),
  },
  {
    name: "forma_get_element",
    title: "Get element",
    description: "One component with its props, style, layouts, events and the bindings that use it.",
    scope: "project.read",
    write: false,
    input: obj({ elementId: { type: "string" } }, ["elementId"]),
    run: async (svc, ctx, a) => {
      const p = (await svc.agentRead(ctx)).project;
      const e = findElement(p, text(a.elementId, "elementId", 80));
      if (!e) throw new AppError(ErrorCode.NotFound, "Element not found.");
      return { ...e, contract: componentContract(e.type), bindings: p.bindings.filter((b) => b.elementId === e.id) };
    },
  },
  {
    name: "forma_list_events",
    title: "List events",
    description: "Every configured visual event (component and screen) with its actions.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => {
      const p = (await svc.agentRead(ctx)).project;
      const out: Json[] = [];
      for (const s of p.frontend.screens) {
        for (const [event, actions] of Object.entries(s.events)) out.push({ screenId: s.id, event, actions });
        for (const e of s.elements) for (const [event, actions] of Object.entries(e.events)) out.push({ screenId: s.id, elementId: e.id, name: e.name, event, actions });
      }
      for (const e of p.frontend.shared) for (const [event, actions] of Object.entries(e.events)) out.push({ shared: true, elementId: e.id, name: e.name, event, actions });
      return out;
    },
  },
  {
    name: "forma_list_components",
    title: "Component contracts",
    description: "The component library: props, supported events and what value each component gives a binding (string, number, boolean).",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async () => COMPONENT_TYPES.map(componentContract),
  },
  {
    name: "forma_get_bindings",
    title: "Get bindings",
    description: "Bindings of component events to backend operations: input mapping, output target, loading and error handling.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => {
      const d = await svc.agentRead(ctx);
      return { backendRevision: d.backendRevision, bindings: d.project.bindings };
    },
  },
  {
    name: "forma_get_backend",
    title: "Get backend",
    description: "Backend operations: name, contracts (input / output fields), errors, handler code, tests. Runtime `sandbox-pending`: code is stored and checked, not executed.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => {
      const d = await svc.agentRead(ctx);
      return { backendRevision: d.backendRevision, ...d.project.backend };
    },
  },
  {
    name: "forma_upsert_operation",
    title: "Create or update an operation",
    description:
      "Creates or replaces a backend operation by name (e.g. auth.login). Fields: name, description, input {fields:[{name,type:string|number|boolean|string[],required,min,max,pattern,enum}]}, output (same), errors [{code,message}], handler {language:'javascript', source} where source is `export default async function handler(input, ctx) {...}` returning the output object or {error:'code'}, tests [{name,input,expect:{ok:true,output}|{ok:false,error}}].",
    scope: "backend.write",
    write: true,
    input: obj({ baseRevision: BASE, operation: { type: "object" } }, ["baseRevision", "operation"]),
    run: async (svc, ctx, a) => svc.agentBackend(ctx, int(a.baseRevision, "baseRevision"), [{ type: "upsertOperation", operation: a.operation }]),
  },
  {
    name: "forma_delete_operation",
    title: "Delete an operation",
    description: "Removes a backend operation by name.",
    scope: "backend.write",
    write: true,
    input: obj({ baseRevision: BASE, name: { type: "string" } }, ["baseRevision", "name"]),
    run: async (svc, ctx, a) => svc.agentBackend(ctx, int(a.baseRevision, "baseRevision"), [{ type: "deleteOperation", name: text(a.name, "name", 120) }]),
  },
  {
    name: "forma_upsert_binding",
    title: "Bind a component event to an operation",
    description:
      "Creates or replaces a binding: {id?, elementId, event (press|change|submit|itemPress|confirm|cancel|finish), operation, input: {field: {from:'element', elementId} | {from:'const', value}}, output: {targetId, field} | null, loading: {disable, text}, errorTargetId, onSuccess: [actions], onError: [actions]}. Actions: navigate{screenId}, back, playSound{resourceId}, setValue{targetId,value}, toggleValue{targetId}, openDialog{targetId}, closeDialog{targetId}, showToast{text}, timer{targetId,command}.",
    scope: "bindings.write",
    write: true,
    input: obj({ baseRevision: BASE, binding: { type: "object" } }, ["baseRevision", "binding"]),
    run: async (svc, ctx, a) => svc.agentBackend(ctx, int(a.baseRevision, "baseRevision"), [{ type: "upsertBinding", binding: a.binding }]),
  },
  {
    name: "forma_delete_binding",
    title: "Delete a binding",
    description: "Removes a binding by id.",
    scope: "bindings.write",
    write: true,
    input: obj({ baseRevision: BASE, id: { type: "string" } }, ["baseRevision", "id"]),
    run: async (svc, ctx, a) => svc.agentBackend(ctx, int(a.baseRevision, "baseRevision"), [{ type: "deleteBinding", id: text(a.id, "id", 80) }]),
  },
  {
    name: "forma_backend_commands",
    title: "Backend batch",
    description: "Applies several backend commands atomically: [{type:'upsertOperation',operation}|{type:'deleteOperation',name}|{type:'upsertBinding',binding}|{type:'deleteBinding',id}].",
    scope: "backend.write",
    write: true,
    input: obj({ baseRevision: BASE, commands: { type: "array", items: { type: "object" }, maxItems: 50 } }, ["baseRevision", "commands"]),
    run: async (svc, ctx, a) => svc.agentBackend(ctx, int(a.baseRevision, "baseRevision"), a.commands as BackendCommand[]),
  },
  {
    name: "forma_check",
    title: "Check types and contracts",
    description: "Checks the whole project: handler syntax, contracts, tests against contracts, every binding (element, event, operation, field mapping and value types), action targets.",
    scope: "project.read",
    write: false,
    input: obj({}),
    run: async (svc, ctx) => svc.agentCheck(ctx),
  },
  {
    name: "forma_run_tests",
    title: "Run allowed tests",
    description: "Runs the contract tests of operations (input and expected output against the contracts). Handler code is not executed: Forma has no isolated runtime yet.",
    scope: "tests.run",
    write: false,
    input: obj({ operation: { type: "string" } }),
    run: async (svc, ctx, a) => svc.agentTests(ctx, typeof a.operation === "string" && a.operation ? a.operation : undefined),
  },
  {
    name: "forma_list_revisions",
    title: "List revisions",
    description: "History of the frontend and backend layers: revision, who (person or agent), what changed.",
    scope: "project.read",
    write: false,
    input: obj({ layer: { type: "string", enum: ["frontend", "backend"] } }),
    run: async (svc, ctx, a) => svc.agentRevisions(ctx, a.layer === "frontend" || a.layer === "backend" ? a.layer : undefined),
  },
  {
    name: "forma_get_revision",
    title: "Get a revision",
    description: "The snapshot of a layer at a revision.",
    scope: "project.read",
    write: false,
    input: obj({ layer: { type: "string", enum: ["frontend", "backend"] }, revision: { type: "integer" } }, ["layer", "revision"]),
    run: async (svc, ctx, a) => svc.agentRevision(ctx, layerOf(a.layer), int(a.revision, "revision")),
  },
  {
    name: "forma_diff",
    title: "Diff revisions",
    description: "What changed in a layer between two revisions.",
    scope: "project.read",
    write: false,
    input: obj({ layer: { type: "string", enum: ["frontend", "backend"] }, from: { type: "integer" }, to: { type: "integer" } }, ["layer", "from", "to"]),
    run: async (svc, ctx, a) => svc.agentDiff(ctx, layerOf(a.layer), int(a.from, "from"), int(a.to, "to")),
  },
  {
    name: "forma_rollback_backend",
    title: "Roll the backend back",
    description: "Restores the backend and bindings of an earlier revision (as a new revision).",
    scope: "backend.write",
    write: true,
    input: obj({ baseRevision: BASE, revision: { type: "integer" } }, ["baseRevision", "revision"]),
    run: async (svc, ctx, a) => svc.agentRollback(ctx, int(a.revision, "revision"), int(a.baseRevision, "baseRevision")),
  },
  {
    name: "forma_frontend_commands",
    title: "Change the interface",
    description:
      "Only with the frontend.write permission (off by default): applies the visual editor's own commands atomically (addElement, updateElement, setLayout, setEvent, addScreen, ...). Without it, propose interface changes to the person instead.",
    scope: "frontend.write",
    write: true,
    input: obj({ baseRevision: BASE, commands: { type: "array", items: { type: "object" }, maxItems: 100 } }, ["baseRevision", "commands"]),
    run: async (svc, ctx, a) => svc.agentFrontend(ctx, int(a.baseRevision, "baseRevision"), a.commands as Command[]),
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Runs a tool for an agent: scope check, audit (success and failure). */
async function runTool(svc: FormaService, ctx: AgentContext, tool: Tool, args: Json) {
  try {
    svc.require(ctx, tool.scope);
    const result = await tool.run(svc, ctx, args ?? {});
    const r = result as { backendRevision?: number; frontendRevision?: number; changes?: string[] };
    await svc.audit(ctx.agent.projectId, ctx.agent, "agent", tool.name, true, tool.write ? { revision: r.backendRevision ?? r.frontendRevision, changes: r.changes?.slice(0, 20) } : {});
    return result;
  } catch (e) {
    const code = e instanceof AppError ? e.code : "internal_error";
    await svc.audit(ctx.agent.projectId, ctx.agent, "agent", tool.name, false, { error: code, message: e instanceof Error ? e.message.slice(0, 200) : "" });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// MCP (JSON-RPC 2.0 over Streamable HTTP; stateless, JSON responses)

const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

function rpcError(id: RpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

async function handleRpc(svc: FormaService, ctx: AgentContext, msg: RpcRequest) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : MCP_VERSIONS[0]!;
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "voidex-forma", title: "Voidex Forma", version: "1.0.0" },
          instructions:
            "You are connected to one Voidex Forma app project. The person builds the interface visually; you build the backend: read the project (forma_get_project), create operations with contracts and code (forma_upsert_operation), bind component events to them (forma_upsert_binding), then run forma_check and forma_run_tests. Pass the revision you read as baseRevision on every write. Do not change the interface unless you have frontend.write; otherwise suggest changes to the person.",
        },
      };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return { jsonrpc: "2.0", id: msg.id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: TOOLS.filter((t) => ctx.scopes.has(t.scope)).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.input,
            annotations: { readOnlyHint: !t.write, destructiveHint: t.write, idempotentHint: !t.write, openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const name = msg.params?.name;
      const tool = typeof name === "string" ? BY_NAME.get(name) : undefined;
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${String(name)}`);
      try {
        const result = await runTool(svc, ctx, tool, (msg.params?.arguments as Json) ?? {});
        return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: Array.isArray(result) ? { items: result } : result, isError: false } };
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        // Tool failures are results the model can read and fix (not protocol errors).
        const body = { error: { code: e.code, message: e.message, ...e.options.details } };
        return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(body) }], isError: true } };
      }
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// ---------------------------------------------------------------------------
// OpenAPI 3.1 for REST clients (ChatGPT actions and others)

interface Route {
  method: "get" | "post" | "put" | "delete";
  path: string;
  tool: string;
  /** Builds the tool arguments from the request. */
  args: (req: FastifyRequest) => Json;
}

const p = (req: FastifyRequest) => req.params as Json;
const q = (req: FastifyRequest) => req.query as Json;
const b = (req: FastifyRequest) => (req.body ?? {}) as Json;

export const ROUTES: Route[] = [
  { method: "get", path: "/project", tool: "forma_get_project", args: () => ({}) },
  { method: "get", path: "/project/info", tool: "forma_get_info", args: () => ({}) },
  { method: "get", path: "/screens", tool: "forma_list_screens", args: () => ({}) },
  { method: "get", path: "/screens/:screenId/tree", tool: "forma_get_screen_tree", args: p },
  { method: "get", path: "/elements/:elementId", tool: "forma_get_element", args: p },
  { method: "get", path: "/events", tool: "forma_list_events", args: () => ({}) },
  { method: "get", path: "/components", tool: "forma_list_components", args: () => ({}) },
  { method: "get", path: "/bindings", tool: "forma_get_bindings", args: () => ({}) },
  { method: "get", path: "/backend", tool: "forma_get_backend", args: () => ({}) },
  { method: "put", path: "/backend/operations/:name", tool: "forma_upsert_operation", args: (r) => ({ baseRevision: b(r).baseRevision, operation: { ...(b(r).operation as Json), name: p(r).name } }) },
  { method: "delete", path: "/backend/operations/:name", tool: "forma_delete_operation", args: (r) => ({ baseRevision: q(r).baseRevision, name: p(r).name }) },
  { method: "post", path: "/backend/commands", tool: "forma_backend_commands", args: b },
  { method: "post", path: "/backend/rollback", tool: "forma_rollback_backend", args: b },
  { method: "put", path: "/bindings/:id", tool: "forma_upsert_binding", args: (r) => ({ baseRevision: b(r).baseRevision, binding: { ...(b(r).binding as Json), id: p(r).id } }) },
  { method: "delete", path: "/bindings/:id", tool: "forma_delete_binding", args: (r) => ({ baseRevision: q(r).baseRevision, id: p(r).id }) },
  { method: "post", path: "/check", tool: "forma_check", args: () => ({}) },
  { method: "post", path: "/tests/run", tool: "forma_run_tests", args: b },
  { method: "get", path: "/revisions", tool: "forma_list_revisions", args: q },
  { method: "get", path: "/revisions/:layer/:revision", tool: "forma_get_revision", args: p },
  { method: "get", path: "/diff", tool: "forma_diff", args: q },
  { method: "post", path: "/frontend/commands", tool: "forma_frontend_commands", args: b },
];

export function openApi(origin: string) {
  const paths: Json = {};
  for (const r of ROUTES) {
    const tool = BY_NAME.get(r.tool)!;
    const path = r.path.replace(/:(\w+)/g, "{$1}");
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const props = (tool.input.properties ?? {}) as Json;
    const queryParams =
      r.method === "get" || r.method === "delete"
        ? Object.keys(props)
            .filter((k) => !r.path.includes(`:${k}`))
            .map((k) => ({ name: k, in: "query", required: ((tool.input.required as string[]) ?? []).includes(k), schema: props[k] }))
        : [];
    (paths[path] ??= {} as Json) as Json;
    (paths[path] as Json)[r.method] = {
      operationId: tool.name,
      summary: tool.title,
      description: `${tool.description} Permission: ${tool.scope}.`,
      parameters: [...params, ...queryParams],
      ...(r.method === "post" || r.method === "put" ? { requestBody: { required: true, content: { "application/json": { schema: tool.input } } } } : {}),
      responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } }, "401": { description: "No or invalid agent token" }, "403": { description: "Missing permission" }, "409": { description: "Stale baseRevision" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Voidex Forma agent API",
      version: "1.0.0",
      description:
        "Typed access of AI agents to one Forma app project: read the interface, write the backend (operations with contracts) and bind component events to it. Authenticate with the project connection token from Forma → AI.",
    },
    servers: [{ url: `${origin}/api/forma/agent/v1` }],
    components: { securitySchemes: { formaToken: { type: "http", scheme: "bearer", bearerFormat: "fma_..." } } },
    security: [{ formaToken: [] }],
    paths,
  };
}

function originOf(req: FastifyRequest) {
  return `${req.protocol}://${req.host}`;
}

/** Agent REST routes (prefix /api/forma/agent/v1) and the MCP endpoint (/api/forma/mcp). */
export const formaAgentRoutes: FastifyPluginAsync<{ service: () => FormaService }> = async (app, opts) => {
  const scale = app.ctx.config.rateLimitScale;
  const limit = { config: { rateLimit: { max: 120 * scale, timeWindow: "1 minute" } }, bodyLimit: 256 * 1024 };
  const svc = () => opts.service();
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.get("/agent/v1/openapi.json", async (req) => openApi(originOf(req)));

  for (const r of ROUTES) {
    const tool = BY_NAME.get(r.tool)!;
    app.route({
      method: r.method.toUpperCase() as "GET",
      url: `/agent/v1${r.path}`,
      ...limit,
      handler: async (req: FastifyRequest) => {
        const ctx = await svc().authenticateAgent(req.headers.authorization);
        return runTool(svc(), ctx, tool, r.args(req));
      },
    });
  }

  app.get("/mcp", { config: limit.config }, async (_req, reply: FastifyReply) => {
    // No server-initiated stream: every answer comes back on its POST.
    reply.header("Allow", "POST");
    return reply.status(405).send({ error: { code: "method_not_allowed", message: "Use POST (MCP Streamable HTTP, JSON responses)." } });
  });

  app.post("/mcp", limit, async (req, reply) => {
    let ctx: AgentContext;
    try {
      ctx = await svc().authenticateAgent(req.headers.authorization);
    } catch (e) {
      reply.header("WWW-Authenticate", 'Bearer realm="voidex-forma"');
      throw e;
    }
    const body = req.body as RpcRequest | RpcRequest[];
    if (Array.isArray(body)) {
      if (body.length > 20) return rpcError(null, -32600, "Batch too large");
      const out = (await Promise.all(body.map((m) => handleRpc(svc(), ctx, m)))).filter(Boolean);
      return out.length ? out : reply.status(202).send();
    }
    const out = await handleRpc(svc(), ctx, body);
    if (out === null) return reply.status(202).send();
    reply.header("Mcp-Protocol-Version", MCP_VERSIONS[0]);
    return out;
  });
};

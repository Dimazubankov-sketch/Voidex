import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_REGISTRY, type InstalledAppDto } from "@voidex/shared";
import { createElement, sampleBackendCommands, sampleProject, type FormaAgentCreated, type FormaProjectDto, type Project } from "@voidex/forma";
import { Device, createTestEnv, signUp, type TestEnv } from "./helpers.js";
import { checkSyntax } from "../src/services/forma.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.app.close();
});

async function person(first: string) {
  const d = new Device(env.app);
  const r = await signUp(d, { firstName: first, lastName: "Формина" });
  return { d, id: r.user.id as string };
}

/** An AI client: only its token, no cookies, no session. */
async function agent(token: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await env.app.inject({
    method: method as "GET",
    url,
    payload: body as object | undefined,
    headers: { authorization: `Bearer ${token}`, "x-voidex-client": "native", "x-test-client": `agent-${token.slice(4, 12)}`, ...headers },
  });
  let json: any;
  try {
    json = res.json();
  } catch {
    json = res.body;
  }
  return { status: res.statusCode, body: json };
}

async function connect(d: Device, projectId: string, scopes: string[] = ["project.read", "backend.write", "bindings.write", "tests.run"], ttlHours = 24) {
  const r = await d.post(`/api/forma/projects/${projectId}/agents`, { name: "Claude Code", client: "claude-code", scopes, ttlHours });
  expect(r.status).toBe(201);
  return r.body as FormaAgentCreated;
}

const doc = (p: Project) => ({ name: p.name, settings: p.settings, frontend: p.frontend });

describe("Forma: app registration", () => {
  it("is a preinstalled Voidex app in the developer tools category", async () => {
    const a = await person("Алиса");
    const apps = (await a.d.get("/api/apps")).body as InstalledAppDto[];
    const forma = apps.find((x) => x.id === "forma")!;
    expect(forma).toBeTruthy();
    expect(forma.manifest.name.ru).toBe("Forma");
    expect(forma.manifest.category).toBe("developer");
    expect(forma.version).toBe(APP_REGISTRY.forma.version);
  });
});

describe("Forma: projects (person)", () => {
  it("creates, lists, saves the frontend with revisions; refuses stale saves; isolates accounts", async () => {
    const a = await person("Борис");
    const b = await person("Вера");
    const created = await a.d.post("/api/forma/projects", { name: "Моё приложение" });
    expect(created.status).toBe(201);
    const dto = created.body as FormaProjectDto;
    expect(dto.project.kind).toBe("app");
    expect(dto.frontendRevision).toBe(1);
    const p = dto.project;
    const button = createElement("button", p.frontend.screens[0]!, p.settings.frames, []);
    p.frontend.screens[0]!.elements.push(button);
    const saved = await a.d.put(`/api/forma/projects/${p.id}/frontend`, { baseRevision: 1, document: doc(p) });
    expect(saved.status).toBe(200);
    expect(saved.body.frontendRevision).toBe(2);
    // The same base again = someone else's change in between: refused.
    const stale = await a.d.put(`/api/forma/projects/${p.id}/frontend`, { baseRevision: 1, document: doc(p) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("forma_conflict");
    // Invalid documents are refused with a path.
    const bad = await a.d.put(`/api/forma/projects/${p.id}/frontend`, { baseRevision: 2, document: { ...doc(p), frontend: { screens: [] } } });
    expect(bad.status).toBe(400);
    const list = (await a.d.get("/api/forma/projects")).body;
    expect(list.map((x: { name: string }) => x.name)).toEqual(["Моё приложение"]);
    // Another account sees nothing and can touch nothing.
    expect((await b.d.get("/api/forma/projects")).body).toEqual([]);
    expect((await b.d.get(`/api/forma/projects/${p.id}`)).status).toBe(404);
    expect((await b.d.put(`/api/forma/projects/${p.id}/frontend`, { baseRevision: 2, document: doc(p) })).status).toBe(404);
    expect((await b.d.post(`/api/forma/projects/${p.id}/agents`, { client: "chatgpt", scopes: [], ttlHours: 1 })).status).toBe(404);
    expect((await b.d.delete(`/api/forma/projects/${p.id}`)).status).toBe(404);
    const anon = new Device(env.app);
    expect((await anon.get("/api/forma/projects")).status).toBe(401);
  });

  it("a person cannot write the backend: no route accepts it, and the save ignores it", async () => {
    const a = await person("Глеб");
    const p = ((await a.d.post("/api/forma/projects", { name: "X", template: "sample" })).body as FormaProjectDto).project;
    for (const method of ["PUT", "PATCH", "POST", "DELETE"]) {
      const r = await a.d.request(method, `/api/forma/projects/${p.id}/backend`, { backend: { operations: [] } });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("forma_backend_read_only");
    }
    const withBackend = { ...doc(p), backend: { runtime: "sandbox-pending", operations: [{ name: "evil.op", handler: { source: "x" } }] }, bindings: [{ id: "b" }] };
    expect((await a.d.put(`/api/forma/projects/${p.id}/frontend`, { baseRevision: 1, document: withBackend })).status).toBe(200);
    const after = ((await a.d.get(`/api/forma/projects/${p.id}`)).body as FormaProjectDto).project;
    expect(after.backend.operations).toEqual([]);
    expect(after.bindings).toEqual([]);
    // A person's session token is not an agent token.
    const r = await env.app.inject({ method: "GET", url: "/api/forma/agent/v1/project", headers: { authorization: `Bearer ${a.d.accessToken}` } });
    expect(r.statusCode).toBe(401);
  });
});

describe("Forma: AI agents", () => {
  it("an agent reads the project, writes the backend and binds the button; the person sees it read-only", async () => {
    const a = await person("Дарья");
    const fe = sampleProject("Демо");
    const created = ((await a.d.post("/api/forma/projects", { name: "Демо", template: "sample" })).body as FormaProjectDto).project;
    expect(created.frontend.screens.map((s) => s.name)).toEqual(fe.frontend.screens.map((s) => s.name));
    const conn = await connect(a.d, created.id);
    expect(conn.token).toMatch(/^fma_[A-Za-z0-9_-]{40}$/);
    expect(conn.endpoints.mcp).toMatch(/\/api\/forma\/mcp$/);

    const info = await agent(conn.token, "GET", "/api/forma/agent/v1/project/info");
    expect(info.status).toBe(200);
    expect(info.body.backendRevision).toBe(1);
    const screens = (await agent(conn.token, "GET", "/api/forma/agent/v1/screens")).body;
    const tree = (await agent(conn.token, "GET", `/api/forma/agent/v1/screens/${screens[0].id}/tree`)).body;
    expect(tree.elements.some((e: { name: string }) => e.name === "Поздороваться")).toBe(true);
    expect((await agent(conn.token, "GET", "/api/forma/agent/v1/components")).body.length).toBeGreaterThan(30);

    const commands = sampleBackendCommands(created);
    const write = await agent(conn.token, "POST", "/api/forma/agent/v1/backend/commands", { baseRevision: 1, commands });
    expect(write.status).toBe(200);
    expect(write.body.backendRevision).toBe(2);
    expect(write.body.changes[0]).toBe("+ операция demo.greet");
    // Stale base: refused.
    const stale = await agent(conn.token, "POST", "/api/forma/agent/v1/backend/commands", { baseRevision: 1, commands });
    expect(stale.status).toBe(409);

    const check = await agent(conn.token, "POST", "/api/forma/agent/v1/check");
    expect(check.body.ok).toBe(true);
    const tests = await agent(conn.token, "POST", "/api/forma/agent/v1/tests/run", {});
    expect(tests.body).toMatchObject({ executed: false, passed: 2, failed: 0 });

    // The person sees the operation and binding, with who wrote it.
    const seen = ((await a.d.get(`/api/forma/projects/${created.id}`)).body as FormaProjectDto).project;
    expect(seen.backend.operations[0]!.name).toBe("demo.greet");
    expect(seen.backend.operations[0]!.updatedBy).toBe("Claude Code");
    expect(seen.bindings).toHaveLength(1);
    // Visual edits and agent writes are separate layers: the person's save still works on revision 1.
    expect((await a.d.put(`/api/forma/projects/${created.id}/frontend`, { baseRevision: 1, document: doc(seen) })).status).toBe(200);
    const hist = (await a.d.get(`/api/forma/projects/${created.id}/history`)).body;
    expect(hist.some((h: { actor: string; agentName: string }) => h.actor === "agent" && h.agentName === "Claude Code")).toBe(true);
    const audit = (await a.d.get(`/api/forma/projects/${created.id}/audit`)).body;
    expect(audit.some((x: { action: string; ok: boolean }) => x.action === "forma_backend_commands" && x.ok)).toBe(true);
    expect(audit.some((x: { action: string; ok: boolean }) => x.action === "forma_backend_commands" && !x.ok)).toBe(true);

    // Diff and rollback of the backend layer.
    const diff = await agent(conn.token, "GET", "/api/forma/agent/v1/diff?layer=backend&from=1&to=2");
    expect(diff.body.changes).toContain("+ операция demo.greet");
    const rb = await agent(conn.token, "POST", "/api/forma/agent/v1/backend/rollback", { revision: 1, baseRevision: 2 });
    expect(rb.status).toBe(200);
    expect((await agent(conn.token, "GET", "/api/forma/agent/v1/backend")).body.operations).toEqual([]);
  });

  it("scopes, other projects, revocation, expiry and bad input are enforced", async () => {
    const a = await person("Егор");
    const one = ((await a.d.post("/api/forma/projects", { name: "Один", template: "sample" })).body as FormaProjectDto).project;
    const two = ((await a.d.post("/api/forma/projects", { name: "Два" })).body as FormaProjectDto).project;
    const readOnly = await connect(a.d, one.id, ["project.read"]);
    const op = { name: "x.y", handler: { language: "javascript", source: "export default async () => ({})" } };
    const denied = await agent(readOnly.token, "PUT", "/api/forma/agent/v1/backend/operations/x.y", { baseRevision: 1, operation: op });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("forma_scope_denied");
    // The interface is not the agent's unless granted.
    const full = await connect(a.d, one.id);
    const fe = await agent(full.token, "POST", "/api/forma/agent/v1/frontend/commands", { baseRevision: 1, commands: [{ type: "rename", name: "Взлом" }] });
    expect(fe.status).toBe(403);
    // A token sees only its project.
    const info = (await agent(full.token, "GET", "/api/forma/agent/v1/project")).body as FormaProjectDto;
    expect(info.project.id).toBe(one.id);
    expect(info.project.id).not.toBe(two.id);
    // Invalid operation names / oversize code are refused with a path.
    const badName = await agent(full.token, "PUT", "/api/forma/agent/v1/backend/operations/Bad%20Name", { baseRevision: 1, operation: op });
    expect(badName.status).toBe(400);
    const big = await agent(full.token, "PUT", "/api/forma/agent/v1/backend/operations/big.op", { baseRevision: 1, operation: { ...op, handler: { language: "javascript", source: "x".repeat(300_000) } } });
    expect(big.status).toBe(413);
    // Revoked: refused at once.
    expect((await a.d.delete(`/api/forma/projects/${one.id}/agents/${full.agent.id}`)).status).toBe(200);
    expect((await agent(full.token, "GET", "/api/forma/agent/v1/project")).status).toBe(401);
    // Expired: refused.
    const short = await connect(a.d, one.id, ["project.read"], 1);
    env.clock.advance(2 * 3600_000);
    expect((await agent(short.token, "GET", "/api/forma/agent/v1/project")).status).toBe(401);
    env.clock.advance(-2 * 3600_000);
    // Unknown and malformed tokens.
    expect((await agent("fma_" + "A".repeat(40), "GET", "/api/forma/agent/v1/project")).status).toBe(401);
    expect((await agent("nope", "GET", "/api/forma/agent/v1/project")).status).toBe(401);
    const list = (await a.d.get(`/api/forma/projects/${one.id}/agents`)).body;
    expect(list.find((x: { id: string }) => x.id === full.agent.id).active).toBe(false);
    expect(JSON.stringify(list)).not.toContain(full.token);
  });

  it("frontend.write lets an agent use the editor's commands, with conflict detection", async () => {
    const a = await person("Жанна");
    const p = ((await a.d.post("/api/forma/projects", { name: "Фронт" })).body as FormaProjectDto).project;
    const c = await connect(a.d, p.id, ["project.read", "frontend.write"]);
    const r = await agent(c.token, "POST", "/api/forma/agent/v1/frontend/commands", { baseRevision: 1, commands: [{ type: "addElement", component: "button", screenId: p.frontend.screens[0]!.id }] });
    expect(r.status).toBe(200);
    expect(r.body.frontendRevision).toBe(2);
    // The person's editor still had revision 1: its save is refused instead of overwriting the agent's change.
    expect((await a.d.put(`/api/forma/projects/${p.id}/frontend`, { baseRevision: 1, document: doc(p) })).status).toBe(409);
  });

  it("MCP: initialize, tools/list filtered by scope, tools/call with tool errors as results", async () => {
    const a = await person("Зоя");
    const p = ((await a.d.post("/api/forma/projects", { name: "MCP", template: "sample" })).body as FormaProjectDto).project;
    const c = await connect(a.d, p.id);
    const init = await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "x" } } });
    expect(init.body.result.serverInfo.name).toBe("voidex-forma");
    expect((await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const tools = (await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools.map((t: { name: string }) => t.name);
    expect(tools).toContain("forma_upsert_operation");
    expect(tools).not.toContain("forma_frontend_commands");
    const call = await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "forma_get_info", arguments: {} } });
    expect(call.body.result.isError).toBe(false);
    expect(call.body.result.structuredContent.backendRevision).toBe(1);
    const commands = sampleBackendCommands(p);
    const up = await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "forma_backend_commands", arguments: { baseRevision: 1, commands } } });
    expect(up.body.result.isError).toBe(false);
    const stale = await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "forma_backend_commands", arguments: { baseRevision: 1, commands } } });
    expect(stale.body.result.isError).toBe(true);
    expect(stale.body.result.content[0].text).toContain("forma_conflict");
    expect((await agent(c.token, "POST", "/api/forma/mcp", { jsonrpc: "2.0", id: 6, method: "nope" })).body.error.code).toBe(-32601);
    const noAuth = await env.app.inject({ method: "POST", url: "/api/forma/mcp", payload: { jsonrpc: "2.0", id: 1, method: "initialize" }, headers: { "x-voidex-client": "native" } });
    expect(noAuth.statusCode).toBe(401);
    expect(noAuth.headers["www-authenticate"]).toContain("Bearer");
    const spec = await env.app.inject({ method: "GET", url: "/api/forma/agent/v1/openapi.json" });
    expect(spec.json().paths["/backend/operations/{name}"].put.operationId).toBe("forma_upsert_operation");
  });

  it("syntax check compiles handler code without running it", () => {
    expect(checkSyntax("export default async function handler(input) { return { ok: 1 } }")).toBeNull();
    expect(checkSyntax("export default async function handler(input) { return { ok: }")).toMatch(/Unexpected|token/i);
    expect(checkSyntax("import fs from 'fs'\nexport default () => fs")).toMatch(/import/);
    // Would throw if executed; compiling is harmless.
    expect(checkSyntax("export default 1; throw new Error('ran');")).toBeNull();
  });
});

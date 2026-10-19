import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RiCloseLine, RiFileCopyLine, RiCodeSSlashLine, RiLinkM, RiRobot2Line, RiShieldKeyholeLine, RiHistoryLine, RiCheckboxCircleLine, RiErrorWarningLine, RiLockLine } from "@remixicon/react";
import {
  AGENT_CLIENTS,
  AGENT_SCOPES,
  CLIENT_LABELS,
  DEFAULT_SCOPES,
  SCOPE_LABELS,
  checkProject,
  findElement,
  runContractTests,
  type AgentClient,
  type AgentScope,
  type Contract,
  type FormaAgentCreated,
  type Operation,
  type Project,
} from "@voidex/forma";
import { ApiError } from "@/lib/api";
import { copyText, formaApi } from "../data";

type Tab = "operations" | "bindings" | "ai" | "log";

const dt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const TTL_LABEL: Record<number, string> = { 1: "1 час", 24: "1 день", 168: "7 дней", 720: "30 дней" };

/**
 * Backend and AI of a project. The person reads and copies the backend here;
 * writing it is the job of an authorised AI agent (the server refuses any
 * other writer). Connections give an agent a token for this project only.
 */
export function BackendPanel({ project, phone, backendRevision, onClose, notify }: { project: Project; phone: boolean; backendRevision: number; onClose: () => void; notify: (t: string, tone?: "default" | "danger") => void }) {
  const [tab, setTab] = useState<Tab>("operations");
  const tabs: { id: Tab; label: string; icon: typeof RiCodeSSlashLine }[] = [
    { id: "operations", label: "Операции", icon: RiCodeSSlashLine },
    { id: "bindings", label: "Привязки", icon: RiLinkM },
    { id: "ai", label: "Подключить AI", icon: RiRobot2Line },
    { id: "log", label: "Журнал", icon: RiHistoryLine },
  ];
  return (
    <div className="fx-overlay" role="dialog" aria-label="Backend и AI" data-testid="forma-backend">
      <div className={`fx-backend${phone ? " phone" : ""}`}>
        <header>
          <b>Backend и AI</b>
          <span className="fx-chip">ревизия {backendRevision}</span>
          <span className="flex-1" />
          <button type="button" className="fx-icon-btn" aria-label="Закрыть" onClick={onClose} data-testid="forma-backend-close">
            <RiCloseLine size={19} />
          </button>
        </header>
        <nav className="fx-tabs wide" role="tablist">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)} data-testid={`forma-backend-tab-${id}`}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="fx-backend-body">
          {tab === "operations" && <Operations project={project} notify={notify} />}
          {tab === "bindings" && <Bindings project={project} />}
          {tab === "ai" && <Connections project={project} notify={notify} />}
          {tab === "log" && <Log project={project} />}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <div className="fx-note">
      <RiLockLine size={16} />
      <span>Backend создаёт и изменяет авторизованный AI-агент. В Forma код можно читать и копировать. Код хранится и проверяется, но пока не исполняется: защищённая среда запуска ещё не подключена.</span>
    </div>
  );
}

function ContractTable({ title, c }: { title: string; c: Contract }) {
  return (
    <div className="fx-contract">
      <h5>{title}</h5>
      {c.fields.length ? (
        <table>
          <tbody>
            {c.fields.map((f) => (
              <tr key={f.name}>
                <td>
                  <code>{f.name}</code>
                  {f.required && <i title="обязательное">*</i>}
                </td>
                <td>{f.type}</td>
                <td>
                  {[f.min !== undefined && `от ${f.min}`, f.max !== undefined && `до ${f.max}`, f.pattern && `формат ${f.pattern}`, f.enum && f.enum.join(" | "), f.description].filter(Boolean).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="fx-muted">Нет полей</p>
      )}
    </div>
  );
}

function OperationCard({ op, notify }: { op: Operation; notify: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`fx-op${open ? " open" : ""}`} data-testid="forma-operation">
      <button type="button" className="fx-op-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <code>{op.name}</code>
        <small>
          {op.updatedBy || "агент"} · {dt.format(new Date(op.updatedAt))}
        </small>
      </button>
      {op.description && <p className="fx-op-desc">{op.description}</p>}
      {open && (
        <div className="fx-op-body">
          <div className="fx-contracts">
            <ContractTable title="Вход" c={op.input} />
            <ContractTable title="Ответ" c={op.output} />
          </div>
          {op.errors.length > 0 && (
            <div className="fx-contract">
              <h5>Ошибки</h5>
              <ul>
                {op.errors.map((e) => (
                  <li key={e.code}>
                    <code>{e.code}</code> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="fx-code-head">
            <h5>Код ({op.handler.language})</h5>
            <button
              type="button"
              className="fx-btn sm"
              onClick={async () => notify((await copyText(op.handler.source)) ? "Код скопирован" : "Не удалось скопировать")}
              data-testid="forma-copy-code"
            >
              <RiFileCopyLine size={15} />
              Копировать
            </button>
          </div>
          <pre className="fx-code" aria-label={`Код ${op.name}`} data-testid="forma-code">
            {op.handler.source.split("\n").map((line, i) => (
              <span key={i}>
                <i>{i + 1}</i>
                {line || " "}
                {"\n"}
              </span>
            ))}
          </pre>
          {op.tests.length > 0 && (
            <div className="fx-contract">
              <h5>Тесты контракта</h5>
              <ul>
                {op.tests.map((t) => (
                  <li key={t.name}>
                    {t.name}: <code>{JSON.stringify(t.input)}</code> → <code>{t.expect.ok ? JSON.stringify(t.expect.output) : `ошибка ${t.expect.error}`}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Operations({ project, notify }: { project: Project; notify: (t: string) => void }) {
  const ops = project.backend.operations;
  const tests = useMemo(() => runContractTests(project), [project]);
  return (
    <div className="fx-stack">
      <ReadOnlyNote />
      {ops.length ? (
        <>
          <div className="fx-stats">
            <span>
              <b>{ops.length}</b> операций
            </span>
            <span>
              <b>{tests.filter((t) => t.contract === "passed").length}</b> из {tests.length} тестов контракта пройдено
            </span>
          </div>
          {ops.map((o) => (
            <OperationCard key={o.id} op={o} notify={notify} />
          ))}
        </>
      ) : (
        <div className="fx-home-empty">
          <RiCodeSSlashLine size={26} />
          <b>Операций пока нет</b>
          <p>Подключите AI-агента: он прочитает экраны и компоненты, создаст операции и свяжет их с кнопками.</p>
        </div>
      )}
    </div>
  );
}

function Bindings({ project }: { project: Project }) {
  const diagnostics = useMemo(() => checkProject(project), [project]);
  const errors = diagnostics.filter((d) => d.level === "error");
  return (
    <div className="fx-stack">
      <div className={`fx-check-result ${errors.length ? "bad" : "ok"}`} data-testid="forma-check">
        {errors.length ? <RiErrorWarningLine size={18} /> : <RiCheckboxCircleLine size={18} />}
        <span>{errors.length ? `Проверка: ${errors.length} ${errors.length === 1 ? "ошибка" : "ошибок"}` : "Проверка контрактов и привязок пройдена"}</span>
      </div>
      {diagnostics.length > 0 && (
        <ul className="fx-diags">
          {diagnostics.map((d, i) => (
            <li key={i} className={d.level}>
              {d.message}
            </li>
          ))}
        </ul>
      )}
      {!project.bindings.length && <p className="fx-muted">Привязок нет. Их создаёт AI-агент: какой компонент вызывает какую операцию и что показывает в ответ.</p>}
      {project.bindings.map((b) => {
        const el = findElement(project, b.elementId);
        const name = (id: string | null) => (id ? (findElement(project, id)?.name ?? "удалён") : "");
        return (
          <article key={b.id} className="fx-bind" data-testid="forma-binding">
            <div className="fx-bind-head">
              <b>{el?.name ?? "Элемент удалён"}</b>
              <span>{b.event}</span>
              <span className="arrow">→</span>
              <code>{b.operation}</code>
            </div>
            <dl>
              {Object.entries(b.input).map(([k, src]) => (
                <div key={k}>
                  <dt>
                    <code>{k}</code>
                  </dt>
                  <dd>{src.from === "element" ? `из «${name(src.elementId)}»` : `константа ${JSON.stringify(src.value)}`}</dd>
                </div>
              ))}
              {b.output && (
                <div>
                  <dt>ответ</dt>
                  <dd>
                    <code>{b.output.field}</code> → «{name(b.output.targetId)}»
                  </dd>
                </div>
              )}
              <div>
                <dt>загрузка</dt>
                <dd>{b.loading.disable ? `кнопка недоступна${b.loading.text ? `, «${b.loading.text}»` : ""}` : "без блокировки"}</dd>
              </div>
              <div>
                <dt>ошибка</dt>
                <dd>{b.errorTargetId ? `в «${name(b.errorTargetId)}»` : "сообщением"}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function Instructions({ created, notify }: { created: FormaAgentCreated; notify: (t: string) => void }) {
  const { token, endpoints, agent } = created;
  const claude = `claude mcp add --transport http forma ${endpoints.mcp} \\\n  --header "Authorization: Bearer ${token}" \\\n  --header "X-Voidex-Client: native"`;
  const curl = `curl -H "Authorization: Bearer ${token}" ${endpoints.rest}/project/info`;
  const copy = async (text: string) => notify((await copyText(text)) ? "Скопировано" : "Не удалось скопировать");
  return (
    <div className="fx-created" data-testid="forma-token">
      <div className="fx-note warn">
        <RiShieldKeyholeLine size={16} />
        <span>Ключ показывается один раз. Он даёт доступ только к этому проекту и только с выбранными правами. Не публикуйте его.</span>
      </div>
      <div className="fx-token">
        <code data-testid="forma-token-value">{token}</code>
        <button type="button" className="fx-btn sm" onClick={() => void copy(token)}>
          <RiFileCopyLine size={15} />
          Копировать
        </button>
      </div>
      {(agent.client === "claude-code" || agent.client === "other" || agent.client === "voidex-ai") && (
        <>
          <h5>Claude Code (MCP)</h5>
          <p className="fx-muted">Выполните в терминале проекта, затем попросите Claude: «Подключись к Forma и создай Backend для экрана входа».</p>
          <pre className="fx-code small">{claude}</pre>
          <button type="button" className="fx-btn sm" onClick={() => void copy(claude)}>
            <RiFileCopyLine size={15} />
            Копировать команду
          </button>
        </>
      )}
      {agent.client === "chatgpt" && (
        <>
          <h5>ChatGPT (действия GPT по OpenAPI)</h5>
          <p className="fx-muted">
            В редакторе GPT добавьте действие, импортируйте схему по адресу ниже и выберите аутентификацию «API Key → Bearer» с этим ключом. Сейчас ChatGPT может читать проект и запускать проверки; запись
            требует заголовка X-Voidex-Client, который действия GPT не передают.
          </p>
          <pre className="fx-code small">{endpoints.openapi}</pre>
          <button type="button" className="fx-btn sm" onClick={() => void copy(endpoints.openapi)}>
            <RiFileCopyLine size={15} />
            Копировать адрес схемы
          </button>
        </>
      )}
      <h5>REST API</h5>
      <pre className="fx-code small">{curl}</pre>
    </div>
  );
}

function Connections({ project, notify }: { project: Project; notify: (t: string, tone?: "default" | "danger") => void }) {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ["forma", "agents", project.id], queryFn: () => formaApi.agents(project.id) });
  const [client, setClient] = useState<AgentClient>("claude-code");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AgentScope[]>(DEFAULT_SCOPES);
  const [ttl, setTtl] = useState(24);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<FormaAgentCreated | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const r = await formaApi.connect(project.id, { name: name.trim() || CLIENT_LABELS[client], client, scopes, ttlHours: ttl });
      setCreated(r);
      await qc.invalidateQueries({ queryKey: ["forma", "agents", project.id] });
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Не удалось создать подключение", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fx-stack">
      <div className="fx-note">
        <RiRobot2Line size={16} />
        <span>
          AI-агент работает со структурой проекта через типизированный API: читает экраны и компоненты, пишет Backend и привязки. Ему не передаются ваш аккаунт и секреты Voidex. Все его действия
          записываются в журнал.
        </span>
      </div>
      {created ? (
        <>
          <Instructions created={created} notify={notify} />
          <button type="button" className="fx-btn" onClick={() => setCreated(null)}>
            Готово
          </button>
        </>
      ) : (
        <section className="fx-connect">
          <h4>Новое подключение</h4>
          <div className="fx-choice compact">
            {AGENT_CLIENTS.map((c) => (
              <button key={c} type="button" className={client === c ? "on" : ""} onClick={() => setClient(c)} data-testid={`forma-client-${c}`}>
                <b>{CLIENT_LABELS[c]}</b>
              </button>
            ))}
          </div>
          <label className="fx-field sm">
            <span>Название</span>
            <input value={name} maxLength={60} placeholder={CLIENT_LABELS[client]} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="fx-scopes">
            {AGENT_SCOPES.map((s) => (
              <label key={s} className="fx-check">
                <input
                  type="checkbox"
                  disabled={s === "project.read"}
                  checked={scopes.includes(s)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                  data-testid={`forma-scope-${s}`}
                />
                <span>
                  <b>{SCOPE_LABELS[s].title}</b>
                  <small>{SCOPE_LABELS[s].hint}</small>
                </span>
              </label>
            ))}
          </div>
          <label className="fx-prop-row">
            <span>Срок действия</span>
            <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
              {Object.entries(TTL_LABEL).map(([h, l]) => (
                <option key={h} value={h}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="fx-btn primary" disabled={busy} onClick={() => void create()} data-testid="forma-connect">
            {busy ? "Создаём…" : "Создать ключ подключения"}
          </button>
        </section>
      )}
      <section>
        <h4>Подключения</h4>
        {!agents.data?.length && <p className="fx-muted">Подключений пока нет.</p>}
        {agents.data?.map((a) => (
          <div key={a.id} className={`fx-agent${a.active ? "" : " off"}`} data-testid="forma-agent">
            <div>
              <b>{a.name}</b>
              <small>
                {CLIENT_LABELS[a.client]} · {a.tokenPrefix}… · {a.revokedAt ? "отозван" : a.active ? `до ${dt.format(new Date(a.expiresAt))}` : "истёк"}
                {a.lastUsedAt ? ` · был ${dt.format(new Date(a.lastUsedAt))}` : ""}
              </small>
              <small className="scopes">{a.scopes.map((s) => SCOPE_LABELS[s].title).join(", ")}</small>
            </div>
            {a.active && (
              <button
                type="button"
                className="fx-btn sm danger"
                onClick={async () => {
                  await formaApi.revoke(project.id, a.id);
                  await qc.invalidateQueries({ queryKey: ["forma", "agents", project.id] });
                  notify("Доступ отозван");
                }}
              >
                Отозвать
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function Log({ project }: { project: Project }) {
  const audit = useQuery({ queryKey: ["forma", "audit", project.id], queryFn: () => formaApi.audit(project.id) });
  const history = useQuery({ queryKey: ["forma", "history", project.id], queryFn: () => formaApi.history(project.id) });
  return (
    <div className="fx-log">
      <section>
        <h4>История версий</h4>
        {history.data?.map((h) => (
          <div key={`${h.layer}-${h.revision}`} className="fx-log-row">
            <span className={`fx-chip ${h.layer}`}>{h.layer === "backend" ? "Backend" : "Интерфейс"} {h.revision}</span>
            <span className="who">{h.actor === "agent" ? (h.agentName ?? "AI-агент") : "Вы"}</span>
            <span className="what">{h.summary.join(", ") || "сохранение"}</span>
            <time>{dt.format(new Date(h.createdAt))}</time>
          </div>
        ))}
      </section>
      <section>
        <h4>Действия AI</h4>
        {!audit.data?.length && <p className="fx-muted">Пока пусто.</p>}
        {audit.data?.map((a) => (
          <div key={a.id} className={`fx-log-row${a.ok ? "" : " bad"}`}>
            <span className="who">{a.actor === "agent" ? (a.agentName ?? "AI") : "Вы"}</span>
            <code className="what">{a.action}</code>
            <span className="what">{a.ok ? "" : String(a.detail.error ?? "ошибка")}</span>
            <time>{dt.format(new Date(a.createdAt))}</time>
          </div>
        ))}
      </section>
    </div>
  );
}

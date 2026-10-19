import { useMemo, useState } from "react";
import { RiAddLine, RiSearchLine } from "@remixicon/react";
import { COMPONENTS, TEMPLATES, componentsByCategory, type ComponentSpec } from "@voidex/forma";
import { AppIcon } from "../runtime/icons";
import type { EditorApi } from "./editor";

/** A miniature of the component (drawn, not a screenshot), Bencho-style stage. */
function Mini({ spec }: { spec: ComponentSpec }) {
  switch (spec.type) {
    case "button":
      return <span className="m-btn">Продолжить</span>;
    case "toggle":
      return (
        <span className="m-row">
          <i className="m-line" />
          <i className="m-switch on" />
        </span>
      );
    case "checkbox":
      return (
        <span className="m-row">
          <i className="m-check" />
          <i className="m-line" />
        </span>
      );
    case "slider":
      return (
        <span className="m-slider">
          <i />
        </span>
      );
    case "tabs":
    case "segmented":
      return (
        <span className="m-seg">
          <i className="on" />
          <i />
          <i />
        </span>
      );
    case "textInput":
    case "textArea":
      return <span className="m-input">Введите…</span>;
    case "searchField":
      return (
        <span className="m-input round">
          <AppIcon name="search" size={12} /> Поиск
        </span>
      );
    case "heading":
      return <b className="m-heading">Заголовок</b>;
    case "text":
      return (
        <span className="m-text">
          <i />
          <i />
          <i className="short" />
        </span>
      );
    case "bottomNav":
      return (
        <span className="m-nav">
          {["home", "search", "bell", "user"].map((i, k) => (
            <AppIcon key={i} name={i} size={13} className={k === 0 ? "on" : ""} />
          ))}
        </span>
      );
    case "progress":
      return (
        <span className="m-progress">
          <i />
        </span>
      );
    case "timer":
    case "stopwatch":
      return <b className="m-timer">01:00</b>;
    case "clock":
      return <b className="m-timer">9:41</b>;
    case "timePicker":
      return <b className="m-timer">07 : 30</b>;
    case "list":
      return (
        <span className="m-list">
          <i />
          <i />
          <i />
        </span>
      );
    case "badge":
      return <span className="m-badge">Новое</span>;
    case "notice":
      return <span className="m-notice">Сохранено</span>;
    case "divider":
      return <i className="m-divider" />;
    default:
      return (
        <span className="m-icon" style={{ color: "#6c5cff" }}>
          <AppIcon name={spec.icon} size={20} />
        </span>
      );
  }
}

/** The component library by category, with search, and the screen templates. */
export function ComponentLibrary({ api }: { api: EditorApi }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return componentsByCategory()
      .map((g) => ({ ...g, items: g.items.filter((c) => !term || `${c.label} ${c.description} ${g.label}`.toLowerCase().includes(term)) }))
      .filter((g) => g.items.length);
  }, [q]);
  const sharedTaken = new Set(api.project.frontend.shared.map((e) => e.type));
  const add = (type: ComponentSpec["type"]) => {
    if (api.command({ type: "addElement", component: type, screenId: api.screenId })) api.notify(`${COMPONENTS[type].label}: добавлено`);
  };
  return (
    <div className="fx-library">
      <label className="fx-search">
        <RiSearchLine size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти компонент" aria-label="Найти компонент" />
      </label>
      {groups.map((g) => (
        <section key={g.category} className="fx-lib-group">
          <h3>
            {g.label} <span>{g.items.length}</span>
          </h3>
          <div className="fx-lib-grid">
            {g.items.map((c) => {
              const taken = c.shared && sharedTaken.has(c.type);
              return (
                <button key={c.type} type="button" className="fx-lib-tile" disabled={taken} onClick={() => add(c.type)} data-testid={`forma-add-${c.type}`} title={taken ? "Уже есть в приложении" : `Добавить: ${c.label}`}>
                  <span className="stage">
                    <Mini spec={c} />
                  </span>
                  <span className="meta">
                    <b>{c.label}</b>
                    <small>{taken ? "Уже добавлено" : c.description}</small>
                  </span>
                  <span className="plus" aria-hidden>
                    <RiAddLine size={16} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!q && (
        <section className="fx-lib-group">
          <h3>
            Шаблоны экрана <span>{TEMPLATES.length}</span>
          </h3>
          <div className="fx-lib-list">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="fx-lib-row" onClick={() => api.command({ type: "addTemplate", template: t.id, screenId: api.screenId }) && api.notify(`Шаблон «${t.label}» добавлен`)} data-testid={`forma-template-add-${t.id}`}>
                <b>{t.label}</b>
                <small>{t.description}</small>
                <RiAddLine size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

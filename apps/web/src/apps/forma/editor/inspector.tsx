import { useState } from "react";
import { RiAddLine, RiCloseLine, RiCursorLine, RiFileCopy2Line } from "@remixicon/react";
import { COMPONENTS, ICONS, findScreen, isShared, uid, type Device, type ElementNode, type HConstraint, type ListItem, type NavItem, type PropSpec, type Style, type VConstraint } from "@voidex/forma";
import { AppIcon } from "../runtime/icons";
import type { EditorApi } from "./editor";
import { ElementEvents } from "./events";

const H_LABELS: Record<HConstraint, string> = { left: "Слева", right: "Справа", center: "По центру", stretch: "Растянуть", scale: "Масштаб" };
const V_LABELS: Record<VConstraint, string> = { top: "Сверху", bottom: "Снизу", center: "По центру", stretch: "Растянуть", scale: "Масштаб" };

/** Properties of the selected element (content, layout per device, style) and its events. */
export function Inspector({ api }: { api: EditorApi }) {
  const [tab, setTab] = useState<"props" | "events">("props");
  const el = api.selectedId ? api.project.frontend.screens.flatMap((s) => s.elements).concat(api.project.frontend.shared).find((e) => e.id === api.selectedId) : null;
  if (!el)
    return (
      <div className="fx-inspector-empty" data-testid="forma-inspector-empty">
        <span>
          <RiCursorLine size={22} />
        </span>
        <b>Выберите элемент</b>
        <p>Нажмите на компонент на холсте, чтобы настроить его свойства и события.</p>
      </div>
    );
  return (
    <div className="fx-inspector" data-testid="forma-inspector">
      <div className="fx-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "props"} className={tab === "props" ? "on" : ""} onClick={() => setTab("props")}>
          Свойства
        </button>
        <button type="button" role="tab" aria-selected={tab === "events"} className={tab === "events" ? "on" : ""} onClick={() => setTab("events")} data-testid="forma-tab-events">
          События
          {Object.keys(el.events).length + api.project.bindings.filter((b) => b.elementId === el.id).length > 0 && <i className="dot" />}
        </button>
      </div>
      {tab === "props" ? <Props api={api} el={el} /> : <ElementEvents api={api} el={el} />}
    </div>
  );
}

function Props({ api, el }: { api: EditorApi; el: ElementNode }) {
  const spec = COMPONENTS[el.type];
  const setProp = (key: string, value: unknown, quiet = false) => api.command({ type: "updateElement", id: el.id, props: { [key]: value } }, { quiet });
  return (
    <>
      <section className="fx-sec">
        <label className="fx-field sm">
          <span>Название слоя</span>
          <input value={el.name} maxLength={80} onChange={(e) => api.command({ type: "updateElement", id: el.id, name: e.target.value }, { quiet: true })} data-testid="forma-prop-name" />
        </label>
        {spec.props.map((p) => (
          <PropField key={p.key} api={api} el={el} spec={p} value={el.props[p.key]} onChange={(v, quiet) => setProp(p.key, v, quiet)} />
        ))}
      </section>
      <LayoutSection api={api} el={el} />
      <StyleSection api={api} el={el} />
      <div className="fx-id" title={el.id}>
        {spec.label} · {el.id}
      </div>
    </>
  );
}

function PropField({ api, el, spec, value, onChange }: { api: EditorApi; el: ElementNode; spec: PropSpec; value: unknown; onChange: (v: unknown, quiet?: boolean) => void }) {
  switch (spec.kind) {
    case "text":
      return (
        <label className="fx-field sm">
          <span>{spec.label}</span>
          {spec.multiline ? (
            <textarea rows={3} maxLength={spec.max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value, true)} data-testid={`forma-prop-${spec.key}`} />
          ) : (
            <input maxLength={spec.max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value, true)} data-testid={`forma-prop-${spec.key}`} />
          )}
        </label>
      );
    case "number":
      return (
        <label className="fx-prop-row">
          <span>{spec.label}</span>
          <input type="number" min={spec.min} max={spec.max} step={spec.step} value={Number(value ?? 0)} onChange={(e) => e.target.value !== "" && onChange(e.target.valueAsNumber, true)} data-testid={`forma-prop-${spec.key}`} />
        </label>
      );
    case "boolean":
      return (
        <label className="fx-check">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} data-testid={`forma-prop-${spec.key}`} />
          {spec.label}
        </label>
      );
    case "select":
      return (
        <label className="fx-prop-row">
          <span>{spec.label}</span>
          <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "icon":
      return <IconPicker label={spec.label} value={String(value)} onChange={(v) => onChange(v)} />;
    case "screen":
      return (
        <label className="fx-prop-row">
          <span>{spec.label}</span>
          <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            <option value="">Нет</option>
            {api.project.frontend.screens.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      );
    case "time":
      return (
        <label className="fx-prop-row">
          <span>{spec.label}</span>
          <input type="time" value={String(value ?? "07:30")} onChange={(e) => e.target.value && onChange(e.target.value)} />
        </label>
      );
    case "options": {
      const list = (value as string[]) ?? [];
      return (
        <div className="fx-list-edit">
          <span className="fx-label">{spec.label}</span>
          {list.map((o, i) => (
            <div key={i} className="fx-row-gap">
              <input aria-label={`${spec.label} ${i + 1}`} value={o} maxLength={40} onChange={(e) => onChange(list.map((x, k) => (k === i ? e.target.value : x)), true)} />
              <button type="button" className="fx-icon-btn xs" aria-label="Убрать" disabled={list.length <= 1} onClick={() => onChange(list.filter((_, k) => k !== i))}>
                <RiCloseLine size={15} />
              </button>
            </div>
          ))}
          {list.length < spec.max && (
            <button type="button" className="fx-btn sm ghost" onClick={() => onChange([...list, `Вариант ${list.length + 1}`])}>
              <RiAddLine size={15} />
              Добавить
            </button>
          )}
        </div>
      );
    }
    case "navItems": {
      const items = (value as NavItem[]) ?? [];
      return (
        <div className="fx-list-edit">
          <span className="fx-label">{spec.label}</span>
          {items.map((it, i) => (
            <div key={it.id} className="fx-item-edit">
              <div className="fx-row-gap">
                <IconSelect value={it.icon} onChange={(icon) => onChange(items.map((x, k) => (k === i ? { ...x, icon } : x)))} />
                <input aria-label={`Пункт ${i + 1}`} value={it.label} maxLength={40} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)), true)} />
                <button type="button" className="fx-icon-btn xs" aria-label="Убрать пункт" disabled={items.length <= 1} onClick={() => onChange(items.filter((_, k) => k !== i))}>
                  <RiCloseLine size={15} />
                </button>
              </div>
              <select aria-label={`Экран пункта ${i + 1}`} value={it.screenId} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, screenId: e.target.value } : x)))}>
                {api.project.frontend.screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {items.length < 8 && (
            <button
              type="button"
              className="fx-btn sm ghost"
              onClick={() => onChange([...items, { id: uid("nav"), label: "Раздел", icon: "star", screenId: api.screenId }])}
            >
              <RiAddLine size={15} />
              Добавить пункт
            </button>
          )}
        </div>
      );
    }
    case "listItems": {
      const items = (value as ListItem[]) ?? [];
      return (
        <div className="fx-list-edit">
          <span className="fx-label">{spec.label}</span>
          {items.map((it, i) => (
            <div key={it.id} className="fx-item-edit">
              <div className="fx-row-gap">
                <IconSelect value={it.icon} onChange={(icon) => onChange(items.map((x, k) => (k === i ? { ...x, icon } : x)))} />
                <input aria-label={`Заголовок ${i + 1}`} value={it.title} maxLength={80} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)), true)} />
                <button type="button" className="fx-icon-btn xs" aria-label="Убрать" onClick={() => onChange(items.filter((_, k) => k !== i))}>
                  <RiCloseLine size={15} />
                </button>
              </div>
              {el.type !== "grid" && (
                <input aria-label={`Описание ${i + 1}`} placeholder="Описание" value={it.subtitle} maxLength={160} onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, subtitle: e.target.value } : x)), true)} />
              )}
            </div>
          ))}
          {items.length < spec.max && (
            <button type="button" className="fx-btn sm ghost" onClick={() => onChange([...items, { id: uid("item"), title: `Пункт ${items.length + 1}`, subtitle: "", icon: "star" }])}>
              <RiAddLine size={15} />
              Добавить
            </button>
          )}
        </div>
      );
    }
  }
}

function IconSelect({ value, onChange }: { value: string; onChange: (v: (typeof ICONS)[number]) => void }) {
  return (
    <label className="fx-icon-select" title="Иконка">
      <AppIcon name={value} size={16} />
      <select aria-label="Иконка" value={value} onChange={(e) => onChange(e.target.value as (typeof ICONS)[number])}>
        {ICONS.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
    </label>
  );
}

function IconPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="fx-list-edit">
      <span className="fx-label">{label}</span>
      <div className="fx-icon-grid" role="listbox" aria-label={label}>
        {ICONS.map((i) => (
          <button key={i} type="button" role="option" aria-selected={i === value} className={i === value ? "on" : ""} onClick={() => onChange(i)} title={i}>
            <AppIcon name={i} size={17} />
          </button>
        ))}
      </div>
    </div>
  );
}

function LayoutSection({ api, el }: { api: EditorApi; el: ElementNode }) {
  const d = api.device;
  const l = el.layouts[d];
  const other: Device = d === "phone" ? "desktop" : "phone";
  const screen = findScreen(api.project, api.screenId);
  const frame = api.project.settings.frames[d];
  const set = (layout: Record<string, unknown>, quiet = true) => api.command({ type: "setLayout", id: el.id, device: d, layout }, { quiet });
  return (
    <section className="fx-sec">
      <h3>
        Положение и размер <span className="fx-chip">{d === "phone" ? "Телефон" : "Компьютер"}</span>
      </h3>
      <div className="fx-rect">
        {(["x", "y", "width", "height"] as const).map((k) => (
          <label key={k}>
            <span>{{ x: "X", y: "Y", width: "Ш", height: "В" }[k]}</span>
            <input
              type="number"
              aria-label={{ x: "Положение X", y: "Положение Y", width: "Ширина", height: "Высота" }[k]}
              value={Math.round(l[k])}
              min={0}
              max={k === "x" || k === "width" ? frame.width : (screen?.height[d] ?? frame.height)}
              onChange={(e) => e.target.value !== "" && set({ [k]: e.target.valueAsNumber })}
              data-testid={`forma-layout-${k}`}
            />
          </label>
        ))}
      </div>
      <div className="fx-prop-row">
        <span>По горизонтали</span>
        <select aria-label="Привязка по горизонтали" value={l.h} onChange={(e) => set({ h: e.target.value }, false)}>
          {(Object.keys(H_LABELS) as HConstraint[]).map((k) => (
            <option key={k} value={k}>
              {H_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="fx-prop-row">
        <span>По вертикали</span>
        <select aria-label="Привязка по вертикали" value={l.v} onChange={(e) => set({ v: e.target.value }, false)}>
          {(Object.keys(V_LABELS) as VConstraint[]).map((k) => (
            <option key={k} value={k}>
              {V_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="fx-rect two">
        <label>
          <span>мин.</span>
          <input type="number" aria-label="Минимальная ширина" placeholder="авто" value={l.minWidth ?? ""} min={1} onChange={(e) => set({ minWidth: e.target.value === "" ? null : e.target.valueAsNumber })} />
        </label>
        <label>
          <span>макс.</span>
          <input type="number" aria-label="Максимальная ширина" placeholder="авто" value={l.maxWidth ?? ""} min={1} onChange={(e) => set({ maxWidth: e.target.value === "" ? null : e.target.valueAsNumber })} />
        </label>
      </div>
      <label className="fx-check">
        <input type="checkbox" checked={!l.hidden} onChange={(e) => set({ hidden: !e.target.checked }, false)} />
        Показывать на {d === "phone" ? "телефоне" : "компьютере"}
      </label>
      <button type="button" className="fx-btn sm ghost" onClick={() => api.command({ type: "copyLayout", id: el.id, from: other, to: d })}>
        <RiFileCopy2Line size={15} />
        Взять раскладку с {other === "phone" ? "телефона" : "компьютера"}
      </button>
      {isShared(api.project, el.id) && <p className="fx-muted">Элемент показан на всех экранах (кроме тех, где общие меню выключены).</p>}
    </section>
  );
}

function StyleSection({ api, el }: { api: EditorApi; el: ElementNode }) {
  const f = new Set(COMPONENTS[el.type].styleFields);
  const set = (style: Partial<Style>, quiet = true) => api.command({ type: "updateElement", id: el.id, style }, { quiet });
  return (
    <section className="fx-sec">
      <h3>Оформление</h3>
      {f.has("fill") && <ColorRow label={el.type === "button" ? "Цвет кнопки" : "Цвет"} value={el.style.fill} onChange={(v) => set({ fill: v })} />}
      {f.has("text") && <ColorRow label="Цвет текста" value={el.style.text} onChange={(v) => set({ text: v })} />}
      {f.has("border") && (
        <div className="fx-prop-row">
          <span>Рамка</span>
          <span className="fx-row-gap">
            <input type="checkbox" aria-label="Рамка" checked={el.style.border !== null} onChange={(e) => set({ border: e.target.checked ? "#e4e4e8" : null }, false)} />
            {el.style.border !== null && <input type="color" aria-label="Цвет рамки" value={el.style.border} onChange={(e) => set({ border: e.target.value })} />}
          </span>
        </div>
      )}
      {f.has("radius") && (
        <label className="fx-prop-row">
          <span>Скругление</span>
          <input type="number" min={0} max={200} value={el.style.radius} onChange={(e) => e.target.value !== "" && set({ radius: e.target.valueAsNumber })} aria-label="Скругление" />
        </label>
      )}
      {f.has("fontSize") && (
        <label className="fx-prop-row">
          <span>Размер текста</span>
          <input type="number" min={8} max={120} value={el.style.fontSize} onChange={(e) => e.target.value !== "" && set({ fontSize: e.target.valueAsNumber })} aria-label="Размер текста" />
        </label>
      )}
      {f.has("fontWeight") && (
        <label className="fx-prop-row">
          <span>Начертание</span>
          <select value={el.style.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) as Style["fontWeight"] }, false)}>
            <option value={400}>Обычное</option>
            <option value={500}>Среднее</option>
            <option value={600}>Полужирное</option>
            <option value={700}>Жирное</option>
          </select>
        </label>
      )}
      {f.has("align") && (
        <label className="fx-prop-row">
          <span>Выравнивание</span>
          <select value={el.style.align} onChange={(e) => set({ align: e.target.value as Style["align"] }, false)}>
            <option value="left">Слева</option>
            <option value="center">По центру</option>
            <option value="right">Справа</option>
          </select>
        </label>
      )}
      {f.has("opacity") && (
        <label className="fx-prop-row">
          <span>Прозрачность</span>
          <input type="range" min={0.1} max={1} step={0.05} value={el.style.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} aria-label="Непрозрачность" />
        </label>
      )}
    </section>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="fx-prop-row">
      <span>{label}</span>
      <span className="fx-color">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
        <code>{value.toUpperCase()}</code>
      </span>
    </label>
  );
}

import { useState } from "react";
import { RiAddLine, RiDeleteBinLine, RiFileCopyLine, RiFlagLine, RiMore2Line, RiArrowUpSLine, RiArrowDownSLine } from "@remixicon/react";
import { startScreen, type ScreenRole } from "@voidex/forma";
import type { EditorApi } from "./editor";
import { ActionsEditor } from "./events";

const ROLE_LABEL: Record<ScreenRole, string> = { main: "Главный", registration: "Регистрация", settings: "Настройки" };

/** Screens of the app: open, add, rename, duplicate, reorder, start screen, role, background, scroll, delete. */
export function ScreensPanel({ api }: { api: EditorApi }) {
  const { project } = api;
  const [open, setOpen] = useState<string | null>(null);
  const start = startScreen(project);
  const add = () => {
    const n = project.frontend.screens.length + 1;
    api.command({ type: "addScreen", name: `Экран ${n}` });
  };
  return (
    <div className="fx-screens">
      <button type="button" className="fx-btn block" onClick={add} data-testid="forma-screen-add">
        <RiAddLine size={17} />
        Новый экран
      </button>
      <ul>
        {project.frontend.screens.map((s, i) => {
          const active = s.id === api.screenId;
          const expanded = open === s.id;
          return (
            <li key={s.id} className={active ? "on" : ""}>
              <div className="fx-screen-row">
                <button type="button" className="fx-screen-open" onClick={() => api.setScreen(s.id)} data-testid={`forma-screen-${i}`}>
                  <span className="thumb" style={{ background: s.background }} />
                  <span className="name">
                    <b>{s.name}</b>
                    <small>
                      {s.id === start.id ? "Открывается первым" : s.role ? ROLE_LABEL[s.role] : `${s.elements.length} эл.`}
                    </small>
                  </span>
                </button>
                <button type="button" className="fx-icon-btn sm" aria-label={`Настройки экрана ${s.name}`} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)}>
                  <RiMore2Line size={17} />
                </button>
              </div>
              {expanded && (
                <div className="fx-screen-edit">
                  <label className="fx-field sm">
                    <span>Название</span>
                    <input value={s.name} maxLength={80} onChange={(e) => e.target.value.trim() && api.command({ type: "updateScreen", id: s.id, name: e.target.value }, { quiet: true })} />
                  </label>
                  <label className="fx-field sm">
                    <span>Роль</span>
                    <select value={s.role ?? ""} onChange={(e) => api.command({ type: "updateScreen", id: s.id, role: (e.target.value || null) as ScreenRole | null })}>
                      <option value="">Обычный экран</option>
                      <option value="main">Главный</option>
                      <option value="registration">Регистрация (открывается первым)</option>
                      <option value="settings">Настройки</option>
                    </select>
                  </label>
                  <div className="fx-prop-row">
                    <span>Фон</span>
                    <input type="color" value={s.background} aria-label="Цвет фона экрана" onChange={(e) => api.command({ type: "updateScreen", id: s.id, background: e.target.value }, { quiet: true })} />
                  </div>
                  <div className="fx-prop-row">
                    <span>Прокрутка ({api.device === "phone" ? "телефон" : "ПК"})</span>
                    <select
                      aria-label="Высота экрана"
                      value={String(Math.round(s.height[api.device] / project.settings.frames[api.device].height))}
                      onChange={(e) => api.command({ type: "updateScreen", id: s.id, height: { [api.device]: project.settings.frames[api.device].height * Number(e.target.value) } })}
                    >
                      <option value="1">Без прокрутки</option>
                      <option value="2">2 экрана</option>
                      <option value="3">3 экрана</option>
                    </select>
                  </div>
                  <label className="fx-check">
                    <input type="checkbox" checked={!s.hideShared} onChange={(e) => api.command({ type: "updateScreen", id: s.id, hideShared: !e.target.checked })} />
                    Показывать общие меню
                  </label>
                  <div className="fx-sub">При открытии экрана</div>
                  <ActionsEditor api={api} actions={s.events.open ?? []} onChange={(actions) => api.command({ type: "setScreenEvent", id: s.id, event: "open", actions })} />
                  <div className="fx-row-gap wrap">
                    <button type="button" className="fx-btn sm" disabled={project.settings.startScreenId === s.id} onClick={() => api.command({ type: "setStartScreen", id: s.id })}>
                      <RiFlagLine size={15} />
                      Стартовый
                    </button>
                    <button type="button" className="fx-btn sm" onClick={() => api.command({ type: "addScreen", name: `${s.name} (копия)`.slice(0, 80), duplicateOf: s.id })}>
                      <RiFileCopyLine size={15} />
                      Дублировать
                    </button>
                    <button type="button" className="fx-icon-btn sm" aria-label="Выше" disabled={i === 0} onClick={() => api.command({ type: "moveScreen", id: s.id, index: i - 1 })}>
                      <RiArrowUpSLine size={17} />
                    </button>
                    <button type="button" className="fx-icon-btn sm" aria-label="Ниже" disabled={i === project.frontend.screens.length - 1} onClick={() => api.command({ type: "moveScreen", id: s.id, index: i + 1 })}>
                      <RiArrowDownSLine size={17} />
                    </button>
                    <button type="button" className="fx-btn sm danger" disabled={project.frontend.screens.length === 1} onClick={() => api.command({ type: "deleteScreen", id: s.id })}>
                      <RiDeleteBinLine size={15} />
                      Удалить
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

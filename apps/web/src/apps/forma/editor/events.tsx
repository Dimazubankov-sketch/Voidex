import { RiAddLine, RiCloseLine, RiArrowUpSLine, RiCodeSSlashLine, RiPlayFill } from "@remixicon/react";
import { COMPONENTS, EVENT_LABELS, allElements, uid, type Action, type ActionType, type ElementNode } from "@voidex/forma";
import type { EditorApi } from "./editor";
import { playResource } from "../runtime/host";

const ACTION_LABELS: Record<ActionType, string> = {
  navigate: "Открыть экран",
  back: "Назад",
  playSound: "Воспроизвести звук",
  setValue: "Изменить значение",
  toggleValue: "Переключить",
  openDialog: "Открыть модальное окно",
  closeDialog: "Закрыть модальное окно",
  showToast: "Показать сообщение",
  timer: "Таймер",
};

/** A new action of a type with sensible first targets. */
function makeAction(api: EditorApi, type: ActionType): Action | null {
  const p = api.project;
  const els = allElements(p);
  const id = uid("action");
  switch (type) {
    case "navigate": {
      const s = p.frontend.screens.find((x) => x.id !== api.screenId) ?? p.frontend.screens[0]!;
      return { id, type, screenId: s.id };
    }
    case "back":
      return { id, type };
    case "playSound": {
      const r = p.frontend.resources[0];
      if (!r) {
        api.notify("Сначала добавьте звук в проект: раздел «Звуки».", "danger");
        return null;
      }
      return { id, type, resourceId: r.id };
    }
    case "setValue": {
      const t = els.find((e) => COMPONENTS[e.type].value.prop);
      if (!t) {
        api.notify("Нет элементов со значением.", "danger");
        return null;
      }
      return { id, type, targetId: t.id, value: COMPONENTS[t.type].value.kind === "boolean" ? true : COMPONENTS[t.type].value.kind === "number" ? 0 : "" };
    }
    case "toggleValue": {
      const t = els.find((e) => COMPONENTS[e.type].value.kind === "boolean");
      if (!t) {
        api.notify("Добавьте переключатель или флажок.", "danger");
        return null;
      }
      return { id, type, targetId: t.id };
    }
    case "openDialog":
    case "closeDialog": {
      const t = els.find((e) => e.type === "dialog");
      if (!t) {
        api.notify("Добавьте модальное окно из раздела «Контейнеры».", "danger");
        return null;
      }
      return { id, type, targetId: t.id };
    }
    case "showToast":
      return { id, type, text: "Готово" };
    case "timer": {
      const t = els.find((e) => e.type === "timer" || e.type === "stopwatch");
      if (!t) {
        api.notify("Добавьте таймер или секундомер.", "danger");
        return null;
      }
      return { id, type, targetId: t.id, command: "start" };
    }
  }
}

export function ActionsEditor({ api, actions, onChange }: { api: EditorApi; actions: Action[]; onChange: (a: Action[]) => void }) {
  const p = api.project;
  const els = allElements(p);
  const set = (i: number, patch: Partial<Action>) => onChange(actions.map((a, k) => (k === i ? ({ ...a, ...patch } as Action) : a)));
  const targetSelect = (a: Action & { targetId: string }, i: number, filter: (e: ElementNode) => boolean) => (
    <select aria-label="Элемент" value={a.targetId} onChange={(e) => set(i, { targetId: e.target.value } as Partial<Action>)}>
      {els.filter(filter).map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="fx-actions">
      {actions.map((a, i) => (
        <div key={a.id} className="fx-action" data-testid="forma-action">
          <div className="fx-action-head">
            <span className="n">{i + 1}</span>
            <b>{ACTION_LABELS[a.type]}</b>
            {i > 0 && (
              <button type="button" className="fx-icon-btn xs" aria-label="Выше" onClick={() => onChange([...actions.slice(0, i - 1), a, actions[i - 1]!, ...actions.slice(i + 1)])}>
                <RiArrowUpSLine size={15} />
              </button>
            )}
            <button type="button" className="fx-icon-btn xs" aria-label="Убрать действие" onClick={() => onChange(actions.filter((_, k) => k !== i))}>
              <RiCloseLine size={15} />
            </button>
          </div>
          {a.type === "navigate" && (
            <select aria-label="Экран" value={a.screenId} onChange={(e) => set(i, { screenId: e.target.value })}>
              {p.frontend.screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {a.type === "playSound" && (
            <div className="fx-row-gap">
              <select aria-label="Звук" value={a.resourceId} onChange={(e) => set(i, { resourceId: e.target.value })}>
                {p.frontend.resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button type="button" className="fx-icon-btn sm" aria-label="Прослушать" onClick={() => void playResource(p, a.resourceId)}>
                <RiPlayFill size={15} />
              </button>
            </div>
          )}
          {a.type === "setValue" && (
            <>
              {targetSelect(a, i, (e) => !!COMPONENTS[e.type].value.prop)}
              {(() => {
                const t = els.find((e) => e.id === a.targetId);
                const kind = t ? COMPONENTS[t.type].value.kind : "string";
                return kind === "boolean" ? (
                  <select aria-label="Значение" value={String(a.value)} onChange={(e) => set(i, { value: e.target.value === "true" })}>
                    <option value="true">Включить</option>
                    <option value="false">Выключить</option>
                  </select>
                ) : (
                  <input
                    aria-label="Значение"
                    type={kind === "number" ? "number" : "text"}
                    value={String(a.value)}
                    onChange={(e) => set(i, { value: kind === "number" ? Number(e.target.value) || 0 : e.target.value })}
                  />
                );
              })()}
            </>
          )}
          {a.type === "toggleValue" && targetSelect(a, i, (e) => COMPONENTS[e.type].value.kind === "boolean")}
          {(a.type === "openDialog" || a.type === "closeDialog") && targetSelect(a, i, (e) => e.type === "dialog")}
          {a.type === "showToast" && <input aria-label="Текст сообщения" value={a.text} maxLength={200} onChange={(e) => set(i, { text: e.target.value || " " })} />}
          {a.type === "timer" && (
            <>
              {targetSelect(a, i, (e) => e.type === "timer" || e.type === "stopwatch")}
              <select aria-label="Команда" value={a.command} onChange={(e) => set(i, { command: e.target.value as "start" | "pause" | "reset" })}>
                <option value="start">Запустить</option>
                <option value="pause">Пауза</option>
                <option value="reset">Сбросить</option>
              </select>
            </>
          )}
        </div>
      ))}
      <label className="fx-add-action">
        <RiAddLine size={15} />
        <select
          aria-label="Добавить действие"
          value=""
          onChange={(e) => {
            const a = makeAction(api, e.target.value as ActionType);
            if (a) onChange([...actions, a]);
          }}
          data-testid="forma-add-action"
        >
          <option value="">Добавить действие…</option>
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Events of the selected element: what each one does, and which backend operation it calls (read-only). */
export function ElementEvents({ api, el }: { api: EditorApi; el: ElementNode }) {
  const spec = COMPONENTS[el.type];
  const bindings = api.project.bindings.filter((b) => b.elementId === el.id);
  if (!spec.events.length)
    return (
      <p className="fx-muted">
        {spec.type === "bottomNav" || spec.type === "sideNav" ? "Пункты меню открывают свои экраны: настройте их в разделе «Свойства»." : spec.type === "back" ? "Возвращает на предыдущий экран (без истории: на главный)." : "У этого компонента нет событий."}
      </p>
    );
  return (
    <div className="fx-events">
      {spec.events.map((ev) => (
        <section key={ev} className="fx-event" data-testid={`forma-event-${ev}`}>
          <h4>{EVENT_LABELS[ev]}</h4>
          <ActionsEditor api={api} actions={el.events[ev] ?? []} onChange={(actions) => api.command({ type: "setEvent", id: el.id, event: ev, actions })} />
          {bindings
            .filter((b) => b.event === ev)
            .map((b) => (
              <div key={b.id} className="fx-binding" title="Связь создана AI-агентом. Изменить её может агент с правом «Привязки».">
                <RiCodeSSlashLine size={15} />
                <span>
                  Backend: <b>{b.operation}</b>
                  {b.output ? " · результат на экране" : ""}
                </span>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

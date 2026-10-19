import { useState } from "react";
import {
  RiAlignBottom,
  RiAlignCenter,
  RiAlignLeft,
  RiAlignRight,
  RiAlignTop,
  RiAlignVertically,
  RiBringForward,
  RiBringToFront,
  RiCloseLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEditLine,
  RiFileCopyLine,
  RiSendBackward,
  RiSendToBack,
  RiStackLine,
  RiLayoutMasonryLine,
} from "@remixicon/react";
import { COMPONENTS, type ElementNode } from "@voidex/forma";
import type { EditorApi } from "./editor";

/** Tools of the selected element: edit, move mode, duplicate, layers, align, delete. */
export function ElementBar({ api, element, variant }: { api: EditorApi; element: ElementNode; variant: "phone" | "desktop" }) {
  const [menu, setMenu] = useState<"arrange" | "align" | null>(null);
  const shared = COMPONENTS[element.type].shared;
  const run = (fn: () => void) => () => {
    fn();
    setMenu(null);
  };
  return (
    <div className={`fx-elbar ${variant}`} data-testid="forma-element-bar" role="toolbar" aria-label={`Инструменты: ${element.name}`}>
      {menu && (
        <div className="fx-elbar-menu" role="menu">
          {menu === "arrange"
            ? (
                [
                  ["front", RiBringToFront, "На передний план"],
                  ["forward", RiBringForward, "Выше"],
                  ["backward", RiSendBackward, "Ниже"],
                  ["back", RiSendToBack, "На задний план"],
                ] as const
              ).map(([to, Icon, label]) => (
                <button key={to} type="button" role="menuitem" onClick={run(() => api.command({ type: "arrange", id: element.id, to }))}>
                  <Icon size={17} />
                  {label}
                </button>
              ))
            : (
                [
                  ["left", RiAlignLeft, "По левому краю"],
                  ["hcenter", RiAlignCenter, "По центру"],
                  ["right", RiAlignRight, "По правому краю"],
                  ["top", RiAlignTop, "Наверх"],
                  ["vcenter", RiAlignVertically, "По середине"],
                  ["bottom", RiAlignBottom, "Вниз"],
                ] as const
              ).map(([edge, Icon, label]) => (
                <button key={edge} type="button" role="menuitem" onClick={run(() => api.command({ type: "align", id: element.id, device: api.device, edge }))}>
                  <Icon size={17} />
                  {label}
                </button>
              ))}
        </div>
      )}
      <button type="button" onClick={api.openInspector} data-testid="forma-el-edit">
        <RiEditLine size={18} />
        <span>{variant === "phone" ? "Свойства" : "Изменить"}</span>
      </button>
      <button type="button" className={api.moveMode ? "on" : ""} aria-pressed={api.moveMode} onClick={() => api.setMoveMode(!api.moveMode)} data-testid="forma-el-move" title="Режим перемещения (M)">
        <RiDragMove2Line size={18} />
        <span>{variant === "phone" ? "Двигать" : "Переместить"}</span>
      </button>
      {!shared && (
        <button type="button" onClick={() => api.command({ type: "duplicateElement", id: element.id })} data-testid="forma-el-duplicate">
          <RiFileCopyLine size={18} />
          <span>{variant === "phone" ? "Копия" : "Дублировать"}</span>
        </button>
      )}
      <button type="button" className={menu === "align" ? "on" : ""} onClick={() => setMenu(menu === "align" ? null : "align")} aria-haspopup="menu">
        <RiLayoutMasonryLine size={18} />
        <span>{variant === "phone" ? "Ровнять" : "Выровнять"}</span>
      </button>
      <button type="button" className={menu === "arrange" ? "on" : ""} onClick={() => setMenu(menu === "arrange" ? null : "arrange")} aria-haspopup="menu">
        <RiStackLine size={18} />
        <span>Слой</span>
      </button>
      <button type="button" className="danger" onClick={() => api.command({ type: "deleteElement", id: element.id })} data-testid="forma-el-delete">
        <RiDeleteBinLine size={18} />
        <span>Удалить</span>
      </button>
      {variant === "phone" && (
        <button type="button" aria-label="Снять выделение" onClick={() => api.select(null)}>
          <RiCloseLine size={18} />
          <span>Готово</span>
        </button>
      )}
    </div>
  );
}

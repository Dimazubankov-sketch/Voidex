import { RiFlashlightLine, RiMusic2Line, RiCodeSSlashLine, RiEyeOffLine } from "@remixicon/react";
import { COMPONENTS, findScreen, type ElementNode } from "@voidex/forma";
import { AppIcon } from "../runtime/icons";
import type { EditorApi } from "./editor";

/** Elements of the current screen, top layer first, then the menus shared by every screen. */
export function Layers({ api }: { api: EditorApi }) {
  const { project } = api;
  const screen = findScreen(project, api.screenId) ?? project.frontend.screens[0]!;
  const bound = new Set(project.bindings.map((b) => b.elementId));
  const row = (n: ElementNode) => {
    const events = Object.values(n.events).flat();
    return (
      <button key={n.id} type="button" className={`fx-layer${api.selectedId === n.id ? " on" : ""}`} onClick={() => api.select(n.id)} data-testid="forma-layer">
        <AppIcon name={COMPONENTS[n.type].icon} size={15} />
        <span className="name">{n.name}</span>
        {n.layouts[api.device].hidden && <RiEyeOffLine size={13} aria-label="Скрыт на этом устройстве" />}
        {events.some((a) => a?.type === "playSound") && <RiMusic2Line size={13} aria-label="Звук" />}
        {events.some((a) => a?.type !== "playSound") && <RiFlashlightLine size={13} aria-label="События" />}
        {bound.has(n.id) && <RiCodeSSlashLine size={13} aria-label="Связан с Backend" />}
      </button>
    );
  };
  return (
    <div className="fx-layers">
      <div className="fx-sub">
        {screen.name} <span>{screen.elements.length}</span>
      </div>
      {screen.elements.length ? [...screen.elements].reverse().map(row) : <p className="fx-muted">На экране пока нет элементов.</p>}
      {project.frontend.shared.length > 0 && (
        <>
          <div className="fx-sub">
            На всех экранах <span>{project.frontend.shared.length}</span>
          </div>
          {[...project.frontend.shared].reverse().map(row)}
        </>
      )}
    </div>
  );
}

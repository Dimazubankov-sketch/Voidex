import { useLayoutEffect, useRef, useState } from "react";
import { useFormFactor } from "@/lib/form-factor";
import { useWindow } from "@/os/window-context";
import { soundEngine } from "./sounds/engine";
import { Projects } from "./projects";
import { Editor } from "./editor/editor";
import "./forma.css";

const OPEN_KEY = "vx.forma.open";

/** Below this window width Forma uses its phone layout (canvas first, panels in sheets). */
export const PHONE_MAX = 760;

/**
 * Forma: the Voidex app builder. «Мои проекты» → a project in the editor
 * (canvas, library, properties, events, sounds, preview) → the backend and
 * AI connections of the project. Runs natively in a Voidex window.
 */
export function FormaApp() {
  const win = useWindow();
  const ff = useFormFactor();
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [open, setOpenState] = useState<string | null>(() => {
    if (typeof win.params.project === "string") return win.params.project;
    try {
      return sessionStorage.getItem(OPEN_KEY);
    } catch {
      return null;
    }
  });

  useLayoutEffect(() => {
    const el = root.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      ro.disconnect();
      soundEngine.stopAll();
    };
  }, []);

  const setOpen = (id: string | null) => {
    soundEngine.stopAll();
    setOpenState(id);
    try {
      if (id) sessionStorage.setItem(OPEN_KEY, id);
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      /* not remembered */
    }
  };

  const phone = ff !== "desktop" || width < PHONE_MAX;
  return (
    <div ref={root} className={`fx-app${phone ? " fx-phone" : ""}`} data-testid="forma-app" data-layout={phone ? "phone" : "desktop"}>
      {open ? <Editor key={open} projectId={open} phone={phone} onExit={() => setOpen(null)} /> : <Projects phone={phone} onOpen={setOpen} />}
    </div>
  );
}

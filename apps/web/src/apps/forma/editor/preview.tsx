import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RiCloseLine, RiComputerLine, RiRestartLine, RiSmartphoneLine, RiCodeSSlashLine } from "@remixicon/react";
import { PREVIEW_SIZES, type Device, type Project } from "@voidex/forma";
import { ScreenView, useRuntime, type CallLog } from "../runtime/host";
import { soundEngine } from "../sounds/engine";

const STATUS: Record<CallLog["status"], string> = {
  pending: "Выполняется…",
  missing: "Операции нет",
  invalid: "Ошибка данных",
  unavailable: "Backend не запущен",
};

/**
 * Preview: the app as it runs, from its start screen every time (sign-up
 * first when the project has one), at a chosen device size. Uses the same
 * runtime as published apps. Backend calls are made through the gateway,
 * which never pretends to answer: until operations can run in an isolated
 * environment, a call ends in a visible diagnostic state.
 */
export function Preview({ project, initialDevice, phone, onClose, onLastScreen }: { project: Project; initialDevice: Device; phone: boolean; onClose: () => void; onLastScreen: (id: string) => void }) {
  const [device, setDevice] = useState<Device>(initialDevice);
  const [sizeId, setSizeId] = useState(initialDevice);
  const [run, setRun] = useState(0);
  const [log, setLog] = useState(!phone && project.bindings.length > 0);
  const size = PREVIEW_SIZES[device].find((s) => s.id === sizeId) ?? PREVIEW_SIZES[device][1]!;

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      soundEngine.stopAll();
    };
  }, [onClose]);

  return (
    <div className="fx-preview" role="dialog" aria-label="Предпросмотр" data-testid="forma-preview">
      <header>
        <div className="fx-preview-title">
          <span className="live" />
          <b>Предпросмотр</b>
          {!phone && <small>{project.name}</small>}
        </div>
        <div className="fx-seg">
          <button type="button" className={device === "phone" ? "on" : ""} aria-label="Телефон" onClick={() => (setDevice("phone"), setSizeId("phone"))}>
            <RiSmartphoneLine size={15} />
          </button>
          <button type="button" className={device === "desktop" ? "on" : ""} aria-label="Компьютер" onClick={() => (setDevice("desktop"), setSizeId("desktop"))}>
            <RiComputerLine size={15} />
          </button>
        </div>
        <select className="fx-size" aria-label="Размер экрана" value={size.id} onChange={(e) => setSizeId(e.target.value as Device)} data-testid="forma-preview-size">
          {PREVIEW_SIZES[device].map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button type="button" className={`fx-icon-btn${log ? " on" : ""}`} aria-label="Вызовы Backend" title="Вызовы Backend" onClick={() => setLog(!log)}>
          <RiCodeSSlashLine size={17} />
        </button>
        <button type="button" className="fx-icon-btn" aria-label="Запустить заново" title="Запустить заново" onClick={() => setRun((r) => r + 1)} data-testid="forma-preview-restart">
          <RiRestartLine size={17} />
        </button>
        <button type="button" className="fx-btn" onClick={onClose} data-testid="forma-preview-close">
          <RiCloseLine size={16} />
          {!phone && "Закрыть"}
        </button>
      </header>
      <PreviewRun key={`${run}-${device}`} project={project} device={device} size={size} pad={phone ? 16 : 40} log={log} onScreen={onLastScreen} />
    </div>
  );
}

function PreviewRun({
  project,
  device,
  size,
  pad,
  log,
  onScreen,
}: {
  project: Project;
  device: Device;
  size: { width: number; height: number };
  pad: number;
  log: boolean;
  onScreen: (id: string) => void;
}) {
  const rt = useRuntime(project, "preview", { onScreen });
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 800, height: 600 });
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, (box.width - pad) / size.width, (box.height - pad) / size.height);
  return (
    <div className="fx-preview-body">
      <div className="fx-preview-stage" ref={stageRef}>
        <div style={{ width: size.width * scale, height: size.height * scale }} className="fx-preview-anchor">
          <div className={`fx-device ${device}`} style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
            <ScreenView project={project} device={device} rt={rt} viewport={size} live />
          </div>
        </div>
      </div>
      {log && (
        <aside className="fx-calls" data-testid="forma-calls">
          <h3>Вызовы Backend</h3>
          {!rt.calls.length ? (
            <p className="fx-muted">{project.bindings.length ? "Нажмите элемент, связанный с Backend." : "В проекте нет привязок к Backend."}</p>
          ) : (
            rt.calls.map((c) => (
              <div key={c.id} className={`fx-call ${c.status}`} data-testid="forma-call" data-status={c.status}>
                <div>
                  <b>{c.operation}</b>
                  <span>{STATUS[c.status]}</span>
                </div>
                <code>{JSON.stringify(c.input)}</code>
                <p>{c.message}</p>
              </div>
            ))
          )}
        </aside>
      )}
    </div>
  );
}

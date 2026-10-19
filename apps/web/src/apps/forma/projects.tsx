import { useState } from "react";
import { RiAddLine, RiArrowRightUpLine, RiDeleteBinLine, RiSmartphoneLine, RiSparkling2Line, RiFileAddLine, RiCodeSSlashLine } from "@remixicon/react";
import type { FormaProjectSummary } from "@voidex/forma";
import { FormaGlyph } from "@/brand/brand";
import { ApiError } from "@/lib/api";
import { WindowHeader } from "@/os/window-context";
import { ConfirmDialog, Sheet, toast } from "@/ui/overlays";
import { formaApi, useInvalidateProjects, useProjects } from "./data";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Cover({ p }: { p: FormaProjectSummary }) {
  return (
    <div className="fx-cover" aria-hidden>
      <div className="fx-cover-grid" />
      <div className="fx-cover-phone" style={{ background: p.cover.background }}>
        <i className="bar" />
        <b>{p.cover.title}</b>
        <i className="line" />
        <i className="line short" />
        {p.cover.button !== null && (
          <span className="btn" style={{ background: p.cover.accent }}>
            {p.cover.button || "Начать"}
          </span>
        )}
      </div>
    </div>
  );
}

/** «Мои проекты»: every app project of the account, newest first; «Создать приложение». */
export function Projects({ phone, onOpen }: { phone: boolean; onOpen: (id: string) => void }) {
  const list = useProjects();
  const refresh = useInvalidateProjects();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FormaProjectSummary | null>(null);
  const projects = list.data ?? [];

  return (
    <div className="fx-home">
      <WindowHeader className="fx-home-header">
        <span className="fx-brand">
          <FormaGlyph className="size-7" />
          <b>Forma</b>
        </span>
      </WindowHeader>
      <main className="fx-home-main">
        <div className="fx-home-head">
          <h1>
            Мои проекты <span>{projects.length || ""}</span>
          </h1>
          <button type="button" className="fx-btn primary" onClick={() => setCreating(true)} data-testid="forma-create">
            <RiAddLine size={18} />
            {phone ? "Создать" : "Создать приложение"}
          </button>
        </div>
        {list.isLoading && <div className="fx-home-empty">Загружаем проекты…</div>}
        {list.isError && (
          <div className="fx-home-empty">
            Не удалось загрузить проекты.{" "}
            <button type="button" className="fx-link" onClick={() => void list.refetch()}>
              Повторить
            </button>
          </div>
        )}
        {list.isSuccess && !projects.length && (
          <div className="fx-home-empty big">
            <FormaGlyph className="size-14" />
            <b>Здесь появятся ваши приложения</b>
            <p>Соберите интерфейс из компонентов, добавьте звуки и переходы, а AI-агент подключит Backend.</p>
            <button type="button" className="fx-btn primary" onClick={() => setCreating(true)}>
              <RiAddLine size={18} />
              Создать приложение
            </button>
          </div>
        )}
        <div className="fx-projects" data-testid="forma-projects">
          {projects.map((p) => (
            <article key={p.id} className="fx-project">
              <button type="button" className="fx-project-open" onClick={() => onOpen(p.id)} aria-label={`Открыть ${p.name}`}>
                <Cover p={p} />
                <span className="fx-project-tag">
                  <RiSmartphoneLine size={13} /> Приложение
                </span>
                <span className="fx-project-go">
                  <RiArrowRightUpLine size={18} />
                </span>
              </button>
              <div className="fx-project-info">
                <button type="button" className="fx-project-name" onClick={() => onOpen(p.id)}>
                  <b>{p.name}</b>
                  <small>
                    {dateFmt.format(new Date(p.updatedAt))} · {p.screens} {plural(p.screens, "экран", "экрана", "экранов")}
                    {p.operations ? (
                      <>
                        {" "}
                        · <RiCodeSSlashLine size={12} className="inline" /> {p.operations}
                      </>
                    ) : null}
                  </small>
                </button>
                <button type="button" className="fx-icon-btn" aria-label={`Удалить ${p.name}`} onClick={() => setDeleting(p)}>
                  <RiDeleteBinLine size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </main>
      <CreateSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          void refresh();
          onOpen(id);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Удалить проект?"
        message={deleting ? `«${deleting.name}», его экраны, Backend и подключения AI будут удалены.` : ""}
        confirmLabel="Удалить"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await formaApi.remove(deleting.id);
          setDeleting(null);
          await refresh();
          toast({ title: "Проект удалён" });
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function CreateSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"blank" | "sample">("blank");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await formaApi.create(name.trim(), template);
      setName("");
      onCreated(r.project.id);
    } catch (e) {
      toast({ title: "Не удалось создать приложение", body: e instanceof ApiError ? e.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Новое приложение" testId="forma-create-sheet" width={460}>
      <form
        className="fx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="fx-field">
          <span>Название</span>
          <input autoFocus value={name} maxLength={80} placeholder="Например, Мой первый проект" onChange={(e) => setName(e.target.value)} data-testid="forma-create-name" />
        </label>
        <div className="fx-caption">С чего начать</div>
        <div className="fx-choice">
          {(
            [
              ["blank", RiFileAddLine, "Пустое приложение", "Один экран для телефона и ПК"],
              ["sample", RiSparkling2Line, "Пример", "Экраны, меню, поиск, таймер, звук и форма"],
            ] as const
          ).map(([id, Icon, title, hint]) => (
            <button key={id} type="button" className={template === id ? "on" : ""} onClick={() => setTemplate(id)} data-testid={`forma-template-${id}`}>
              <Icon size={22} />
              <b>{title}</b>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <div className="fx-form-actions">
          <button type="button" className="fx-btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="fx-btn primary" disabled={!name.trim() || busy} data-testid="forma-create-submit">
            {busy ? "Создаём…" : "Создать"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

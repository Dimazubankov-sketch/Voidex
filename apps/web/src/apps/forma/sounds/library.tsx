import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RiAddLine, RiCheckLine, RiHeart3Fill, RiHeart3Line, RiSearchLine, RiLoader4Line } from "@remixicon/react";
import { COMPONENTS, findElement, uid, type EventName } from "@voidex/forma";
import { loadCatalog, prefersReduced, soundEngine, waveLevels, type SoundCatalog, type SoundEntry } from "./engine";
import type { EditorApi } from "../editor/editor";

const FAVORITES = "vx.forma.sounds.favorites";
const REST = [3, 17, 44, 30, 25, 40, 23, 12, 3];

function readFavorites(): Set<string> {
  try {
    const a = JSON.parse(localStorage.getItem(FAVORITES) ?? "[]") as unknown;
    return new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function usePlaying(id: string) {
  return useSyncExternalStore(
    (cb) => soundEngine.subscribe(cb),
    () => soundEngine.isPlaying(id),
  );
}

/** A sound tile: one press, one playback; the bars follow the real playback position. */
function Tile({ s, added, favorite, onFavorite, onAdd, addLabel }: { s: SoundEntry; added: boolean; favorite: boolean; onFavorite: () => void; onAdd: () => void; addLabel: string }) {
  const playing = usePlaying(s.id);
  const bars = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!playing || prefersReduced()) return;
    let raf = 0;
    let levels = Array(9).fill(1) as number[];
    const frame = () => {
      const pos = soundEngine.position(s.id);
      if (pos !== null) {
        levels = waveLevels(s, pos, levels);
        levels.forEach((v, i) => bars.current[i]?.style.setProperty("--s", v.toFixed(3)));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      bars.current.forEach((b) => b?.style.removeProperty("--s"));
    };
  }, [playing, s]);
  const secs = s.durationMs / 1000;
  return (
    <article className="fx-sound" data-testid="forma-sound" data-sound={s.id}>
      <div className="stage">
        <button
          type="button"
          className={`play${playing ? " playing" : ""}`}
          aria-label={`${playing ? "Играет" : "Прослушать"}: ${s.name}`}
          aria-disabled={playing}
          onPointerEnter={() => void soundEngine.preload(s.id)}
          onClick={() => soundEngine.play(s.id)}
        >
          <span className="wave" aria-hidden>
            {REST.map((h, i) => (
              <i key={i} ref={(el) => void (bars.current[i] = el)} style={{ ["--rest" as string]: `${h}px` }} />
            ))}
          </span>
        </button>
        <button type="button" className={`fav${favorite ? " on" : ""}`} aria-pressed={favorite} aria-label={favorite ? `Убрать из избранного: ${s.name}` : `В избранное: ${s.name}`} onClick={onFavorite}>
          {favorite ? <RiHeart3Fill size={15} /> : <RiHeart3Line size={15} />}
        </button>
      </div>
      <div className="meta">
        <b title={s.name}>{s.name}</b>
        <small>{s.kind === "haptic" ? `${s.haptic?.durationMs ?? s.durationMs} мс · вибрация` : `${secs.toFixed(secs < 1 ? 2 : 1).replace(".", ",")} с`}</small>
      </div>
      <button type="button" className={`add${added ? " done" : ""}`} aria-label={`${addLabel}: ${s.name}`} title={addLabel} onClick={onAdd} data-testid="forma-sound-add">
        {added ? <RiCheckLine size={16} /> : <RiAddLine size={16} />}
      </button>
    </article>
  );
}

/** The Forma sound library: listen, favourite, add to the project or assign to the selected component. */
export function SoundLibrary({ api }: { api: EditorApi }) {
  const [catalog, setCatalog] = useState<SoundCatalog | null>(null);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [view, setView] = useState<"all" | "favorites" | "project">("all");
  const [q, setQ] = useState("");
  const [favorites, setFavorites] = useState(readFavorites);

  useEffect(() => {
    let live = true;
    loadCatalog()
      .then((c) => {
        if (!live) return;
        soundEngine.register(c.sounds);
        setCatalog(c);
        for (const s of c.sounds.slice(0, 12)) void soundEngine.preload(s.id);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);

  const selected = api.selectedId ? findElement(api.project, api.selectedId) : undefined;
  const target: { id: string; name: string; event: EventName } | null = useMemo(() => {
    if (!selected) return null;
    const ev = COMPONENTS[selected.type].events[0];
    return ev ? { id: selected.id, name: selected.name, event: ev } : null;
  }, [selected]);

  const inProject = new Set(api.project.frontend.resources.map((r) => r.libraryId));
  const list = useMemo(() => {
    if (!catalog) return [];
    const term = q.trim().toLocaleLowerCase("ru");
    const names = new Map(catalog.categories.map((c) => [c.id, c.name]));
    return catalog.sounds.filter(
      (s) =>
        (view !== "favorites" || favorites.has(s.id)) &&
        (view !== "project" || inProject.has(s.id)) &&
        (category === "all" || s.category === category) &&
        (!term || [s.name, s.action, names.get(s.category) ?? "", ...s.tags].join(" ").toLocaleLowerCase("ru").includes(term)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, q, category, view, favorites, api.project.frontend.resources]);

  const toggleFavorite = (id: string) => {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES, JSON.stringify([...next]));
    } catch {
      /* not remembered */
    }
  };

  const add = (s: SoundEntry) => {
    const resource = { id: uid("sound"), name: s.name, kind: s.kind, libraryId: s.id, file: s.file, sha256: s.sha256, durationMs: s.durationMs };
    const ok = api.command({ type: "addResource", resource, ...(target ? { assignTo: { id: target.id, event: target.event } } : {}) });
    if (ok) api.notify(target ? `«${s.name}» назначен: ${target.name}` : `«${s.name}» добавлен в проект`);
  };

  if (error)
    return (
      <div className="fx-home-empty">
        Библиотека звуков не загрузилась.{" "}
        <button type="button" className="fx-link" onClick={() => (setError(false), void loadCatalog().then(setCatalog, () => setError(true)))}>
          Повторить
        </button>
      </div>
    );
  if (!catalog)
    return (
      <div className="fx-center-msg small">
        <RiLoader4Line className="fx-spin" size={19} />
        Подключаем библиотеку…
      </div>
    );

  const groups = catalog.categories.map((c) => ({ ...c, items: list.filter((s) => s.category === c.id) })).filter((g) => g.items.length);
  return (
    <div className="fx-sounds" data-testid="forma-sounds">
      <div className={`fx-sound-target${target ? " on" : ""}`}>
        {target ? (
          <>
            Назначить: <b>{target.name}</b>
          </>
        ) : (
          "Звук добавится в ресурсы проекта"
        )}
      </div>
      <label className="fx-search">
        <RiSearchLine size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или действие" aria-label="Поиск звуков" />
      </label>
      <div className="fx-chips" role="tablist" aria-label="Звуки">
        {(
          [
            ["all", "Все"],
            ["favorites", `Избранное${favorites.size ? ` ${favorites.size}` : ""}`],
            ["project", `В проекте${inProject.size ? ` ${inProject.size}` : ""}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "on" : ""} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="fx-chips scroll" role="tablist" aria-label="Категории звуков">
        {[{ id: "all", name: "Все категории" }, ...catalog.categories].map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className={category === c.id ? "on soft" : "soft"} onClick={() => setCategory(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      {!list.length && <p className="fx-muted center">{view === "favorites" && !q ? "Отметьте звук сердечком." : "Ничего не найдено."}</p>}
      {groups.map((g) => (
        <section key={g.id} className="fx-sound-group">
          <h3>
            {g.name} <span>{g.items.length}</span>
            {g.id === "haptic" && <small>звук: превью паттерна</small>}
          </h3>
          <div className="fx-sound-grid">
            {g.items.map((s) => (
              <Tile key={s.id} s={s} added={inProject.has(s.id)} favorite={favorites.has(s.id)} onFavorite={() => toggleFavorite(s.id)} onAdd={() => add(s)} addLabel={target ? "Назначить" : "Добавить в проект"} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { searchSounds, soundById } from "@voidex/clock";
import { cx } from "@/lib/cx";
import { toast } from "@/ui/overlays";
import { previewSound, stopPreview, useClockAudio } from "./audio";
import { ClockIcon } from "./icons";
import { useClockT } from "./strings";
import { SheetHeader } from "./ui";

/**
 * The sound list (inside the alarm editor's sheet, or its own sheet for the
 * timer). The play button previews a sound once; while it plays, that same
 * button is disabled; another one stops it and plays its own; going back,
 * choosing or closing stops the preview.
 */
export function SoundPicker({ value, onPick, onBack, backIsClose }: { value: string; onPick: (id: string) => void; onBack: () => void; backIsClose?: boolean }) {
  const t = useClockT();
  const [q, setQ] = useState("");
  const playing = useClockAudio((s) => s.previewId);
  const rows = useMemo(() => searchSounds(q), [q]);
  const featured = soundById(playing ?? value);
  useEffect(() => () => stopPreview(), []);
  return (
    <div className="vc-sound-picker" data-testid="clock-sound-picker">
      <SheetHeader
        id="clock-sound-title"
        title={t("sound.title")}
        onClose={() => {
          stopPreview();
          onBack();
        }}
        closeLabel={backIsClose ? t("close") : t("back")}
        back={!backIsClose}
      />
      <label className="vc-search">
        <ClockIcon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("sound.search")} aria-label={t("sound.search")} autoComplete="off" data-testid="clock-sound-search" />
      </label>
      <div className="vc-sheet-scroll">
        <div className={cx("vc-sound-feature", playing && "playing")} aria-live="polite">
          <span className="vc-sound-feature-icon">
            <ClockIcon name="sound" />
          </span>
          <h3 data-testid="clock-sound-featured">{featured.name}</h3>
          <p>{t("sound.caption")}</p>
          <div className="vc-waveform" aria-hidden="true">
            {featured.waveform.map((v, i) => (
              <i key={i} style={{ height: `${Math.round(18 + v * 70)}%`, animationDelay: `${(i % 7) * -0.13}s` }} />
            ))}
          </div>
        </div>
        {rows.map((s) => {
          const chosen = s.id === value;
          const isPlaying = playing === s.id;
          return (
            <article key={s.id} className={cx("vc-sound-row", chosen && "chosen")} data-testid="clock-sound-row" data-sound={s.id}>
              <button
                type="button"
                className={cx("vc-sound-play", isPlaying && "playing")}
                disabled={isPlaying}
                aria-label={isPlaying ? t("sound.playing", { name: s.name }) : t("sound.listen", { name: s.name })}
                onClick={() => {
                  previewSound(s.id).catch(() => toast({ title: t("sound.loadFailed"), tone: "danger" }));
                }}
                data-testid="clock-sound-preview"
              >
                <ClockIcon name={isPlaying ? "sound" : "play"} />
              </button>
              <button
                type="button"
                className="vc-sound-select"
                onClick={() => {
                  stopPreview();
                  onPick(s.id);
                }}
                aria-pressed={chosen}
                aria-label={t("sound.choose", { name: s.name })}
                data-testid="clock-sound-choose"
              >
                <strong>{s.name}</strong>
                <small>{t("sound.sec", { n: s.duration.toFixed(1).replace(".", ",") })}</small>
              </button>
              <span className="vc-sound-check" aria-hidden="true">
                {chosen ? <ClockIcon name="check" /> : <i />}
              </span>
            </article>
          );
        })}
        {!rows.length && <p className="vc-empty small">{t("world.nothing")}</p>}
        <p className="vc-sound-credit">{t("sound.credit")}</p>
      </div>
    </div>
  );
}

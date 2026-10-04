import type { Space, Project } from "./model";
/** Reads an image path; VOIDEX passes the adapter's authenticated reader. */
export type MediaReader = (src: string) => Promise<Blob>;
const plainFetch: MediaReader = async (src) => {
  const r = await fetch(src);
  if (!r.ok) throw new Error("Не удалось загрузить изображение");
  return r.blob();
};
export function download(name: string, data: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export async function exportHTML(data: Space | Project, read: MediaReader = plainFetch) {
  const spaces = "spaces" in data ? data.spaces : [data];
  const cloned = structuredClone(spaces);
  for (const s of cloned)
    for (const p of s.slides) {
      for (const b of p.blocks) {
        if (b.src) {
          const blob = await read(b.src).catch(() => {
            throw new Error("Не удалось включить изображение в экспорт");
          });
          b.src = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
        }
      }
      if (p.background.startsWith("/api/")) {
        const blob = await read(p.background).catch(() => {
          throw new Error("Не удалось загрузить фон");
        });
        p.background = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      }
    }
  const colors: Record<string, string> = {
    white: "#fff",
    milk: "linear-gradient(140deg,#fff,#f1eef7)",
    lavender: "radial-gradient(at 100% 0%,#cbb9ff,transparent 65%),#fff",
    split: "linear-gradient(120deg,#fff 50%,#e9e1ff 50%)",
    wave: "linear-gradient(130deg,#a185ff,#6747ed,#3421b7)",
    graphite: "linear-gradient(140deg,#36323f,#17141f)",
  };
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.name)}</title><style>*{box-sizing:border-box}body{margin:0;background:#ececed;color:#17171b;font:18px/1.65 system-ui}header{padding:14px 24px;display:flex;gap:12px;align-items:center;position:sticky;top:0;background:#ffffffed;z-index:3}button{padding:10px 16px;border:0;border-radius:12px;background:#efedff;color:#4b3ce0;cursor:pointer}main{padding:24px}section{margin:0 auto 24px;padding:6%;width:min(1100px,100%);min-height:550px;border-radius:18px;overflow:auto;box-shadow:0 8px 30px #0001}section:after{content:'';display:block;clear:both}h1{font-size:clamp(28px,4vw,48px);line-height:1.2}p{white-space:pre-wrap}blockquote{border-left:3px solid currentColor;padding-left:20px}img{max-width:100%;border-radius:12px}body.horizontal section{display:none;aspect-ratio:16/9;min-height:0}body.horizontal section.active{display:block}body.portrait section{width:min(560px,100%);min-height:780px}body.portrait img{float:none!important;width:100%!important}code{display:block;white-space:pre-wrap;background:#0001;padding:16px}section.active{animation:fade .3s}@keyframes fade{from{opacity:.1;transform:translateY(12px)}}@media(max-width:650px){main{padding:12px}section{padding:24px;min-height:75vh}img{float:none!important;width:100%!important}header{flex-wrap:wrap}h1{font-size:30px}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style><header><strong style="flex:1">${escape(data.name)}</strong><button onclick="document.body.classList.toggle('horizontal');show(0)">Страницы / лента</button><button onclick="document.body.classList.toggle('portrait')">Повернуть</button><button onclick="show(-1)" aria-label="Предыдущая">‹</button><span id="count"></span><button onclick="show(1)" aria-label="Следующая">›</button></header><main>${cloned
    .flatMap((s) =>
      s.slides.map(
        (p) =>
          `<section style="background:${p.background.startsWith("data:") ? `center/cover url('${p.background}')` : colors[p.background] || "#fff"};color:${["wave", "graphite"].includes(p.background) ? "#fff" : "#17171b"}">${p.blocks
            .filter((b) => !b.hidden)
            .map((b) => {
              if (b.kind === "image")
                return `<img src="${escape(b.src || "")}" alt="${escape(b.text)}" style="width:${(b.size / 12) * 100}%;float:${b.align === "center" ? "none" : b.align};margin:0 20px 18px 0">`;
              const text = escape(b.text);
              return b.kind === "heading"
                ? `<h1>${text}</h1>`
                : b.kind === "quote"
                  ? `<blockquote>${text}</blockquote>`
                  : b.kind === "code"
                    ? `<code>${text}</code>`
                    : `<p style="font-weight:${b.bold ? "700" : "400"};font-style:${b.italic ? "italic" : "normal"}">${b.kind === "checklist" ? (b.checked ? "☑ " : "☐ ") : ""}${text}</p>`;
            })
            .join("")}</section>`,
      ),
    )
    .join(
      "",
    )}</main><script>let i=0;const pages=[...document.querySelectorAll('section')];function show(d){i=Math.max(0,Math.min(pages.length-1,i+d));pages.forEach((p,n)=>p.classList.toggle('active',n===i));document.getElementById('count').textContent=(i+1)+' / '+pages.length}show(0);onkeydown=e=>{if(e.key==='ArrowRight')show(1);if(e.key==='ArrowLeft')show(-1)};</script></html>`;
  download(data.name + ".html", html, "text/html");
}
export async function exportProject(projects: Project[], read: MediaReader = plainFetch) {
  const assets: Record<string, string> = {};
  const urls = new Set<string>();
  for (const p of projects) {
    if (p.cover.startsWith("/api/")) urls.add(p.cover);
    for (const s of p.spaces) {
      if (s.cover.startsWith("/api/")) urls.add(s.cover);
      for (const page of s.slides) {
        if (page.background.startsWith("/api/")) urls.add(page.background);
        for (const b of page.blocks) if (b.src) urls.add(b.src);
      }
    }
  }
  for (const url of urls) {
    const blob = await read(url).catch(() => {
      throw new Error("Не удалось включить фото в проект");
    });
    assets[url] = await new Promise<string>((resolve, reject) => {
      const f = new FileReader();
      f.onload = () => resolve(String(f.result));
      f.onerror = reject;
      f.readAsDataURL(blob);
    });
  }
  download((projects[0]?.name || "Voidex") + ".json", JSON.stringify({ version: 1, projects, assets }));
}

import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
const bucket = () => (env as unknown as {
    BUCKET: R2Bucket;
}).BUCKET;
export const accepted = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
export async function POST(req: Request) { const u = await getChatGPTUser(); if (!u)
    return new Response(null, { status: 401 }); if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)
    return new Response(null, { status: 403 }); const type = req.headers.get('content-type') || ''; if (!accepted.includes(type))
    return Response.json({ error: 'Поддерживаются JPEG, PNG, WebP, GIF, MP4, WebM и MOV.' }, { status: 400 }); const limit = type.startsWith('video/') ? 70000000 : 20000000; const size = Number(req.headers.get('content-length')); if (size > limit)
    return Response.json({ error: 'Фото до 20 МБ, видео до 70 МБ.' }, { status: 413 }); try {
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > limit)
        return Response.json({ error: 'Файл слишком большой' }, { status: 413 });
    const id = crypto.randomUUID();
    await bucket().put(id, bytes, { httpMetadata: { contentType: type }, customMetadata: { owner: u.userId } });
    return Response.json({ url: '/api/assets?id=' + id });
}
catch (e) {
    console.error(e);
    return Response.json({ error: 'Не удалось загрузить файл' }, { status: 503 });
} }
export async function GET(req: Request) { const u = await getChatGPTUser(); if (!u)
    return new Response(null, { status: 401 }); const id = new URL(req.url).searchParams.get('id') || ''; if (!/^[a-f0-9-]{36}$/.test(id))
    return new Response(null, { status: 400 }); try {
    const head = await bucket().head(id);
    if (!head || head.customMetadata?.owner !== u.userId)
        return new Response(null, { status: 404 });
    const range = req.headers.get('range');
    const parsed = range?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0, end = head.size - 1;
    if (range && !parsed)
        return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + head.size } });
    if (parsed) {
        if (!parsed[1] && !parsed[2])
            return new Response(null, { status: 416 });
        start = parsed[1] ? Number(parsed[1]) : Math.max(0, head.size - Number(parsed[2]));
        end = parsed[1] && parsed[2] ? Math.min(head.size - 1, Number(parsed[2])) : head.size - 1;
        if (start > end || start >= head.size)
            return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + head.size } });
    }
    const obj = await bucket().get(id, parsed ? { range: { offset: start, length: end - start + 1 } } : undefined);
    if (!obj)
        return new Response(null, { status: 404 });
    const headers: Record<string, string> = { 'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private,max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
    if (parsed)
        headers['Content-Range'] = `bytes ${start}-${end}/${head.size}`;
    return new Response(obj.body, { status: parsed ? 206 : 200, headers });
}
catch (e) {
    console.error(e);
    return new Response(null, { status: 503 });
} }

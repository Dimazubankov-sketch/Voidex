import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { validLibrary, seedLibrary } from '@/features/media/model';
const db = () => (env as unknown as {
    DB: D1Database;
}).DB;
export async function GET() { const u = await getChatGPTUser(); if (!u)
    return Response.json({ error: 'Войдите в приложение' }, { status: 401 }); try {
    const row = await db().prepare('SELECT data,revision FROM media_libraries WHERE owner=?').bind(u.userId).first<{
        data: string;
        revision: number;
    }>();
    return Response.json(row ? { data: JSON.parse(row.data), revision: row.revision } : { data: seedLibrary(), revision: 0 });
}
catch (e) {
    console.error(e);
    return Response.json({ error: 'Не удалось загрузить медиатеку. Попробуйте ещё раз.' }, { status: 503 });
} }
export async function PUT(req: Request) { const u = await getChatGPTUser(); if (!u)
    return new Response(null, { status: 401 }); if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)
    return new Response(null, { status: 403 }); try {
    const text = await req.text();
    if (text.length > 8000000)
        return Response.json({ error: 'Медиатека слишком большая' }, { status: 413 });
    const { data, revision } = JSON.parse(text);
    if (!validLibrary(data) || !Number.isInteger(revision) || revision < 0)
        return Response.json({ error: 'Некорректные данные медиатеки' }, { status: 400 });
    const result = await db().prepare('INSERT INTO media_libraries(owner,data,revision) VALUES(?,?,1) ON CONFLICT(owner) DO UPDATE SET data=excluded.data,revision=media_libraries.revision+1 WHERE media_libraries.revision=?').bind(u.userId, JSON.stringify(data), revision).run();
    if (!result.meta.changes)
        return Response.json({ error: 'Медиатека изменена в другой вкладке. Обновите страницу, прежде сохранив копию изменений.' }, { status: 409 });
    return Response.json({ revision: revision + 1 });
}
catch (e) {
    console.error(e);
    return Response.json({ error: 'Не удалось сохранить. Изменения пока остаются на экране.' }, { status: 503 });
} }

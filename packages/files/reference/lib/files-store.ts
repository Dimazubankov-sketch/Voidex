import { env } from 'cloudflare:workers';
import type {Entry,Kind} from '@/features/files/model';
export const db=()=> (env as unknown as {DB:D1Database}).DB;
export const bucket=()=> (env as unknown as {BUCKET:R2Bucket}).BUCKET;
export type Row=Entry&{owner:string;blob:string;favorite:any;trashed:any;downloaded:any};
export function metadata(r:Row):Entry {const {owner,blob,...rest}=r;return {...rest,favorite:!!r.favorite,trashed:!!r.trashed,downloaded:!!r.downloaded};}
export const error=(message:string,status=400)=>Response.json({error:message},{status});
export async function getFile(id:string,owner?:string){return owner?db().prepare('SELECT * FROM files WHERE id=? AND owner=?').bind(id,owner).first<Row>():db().prepare('SELECT * FROM files WHERE id=?').bind(id).first<Row>();}
export type Share={token:string;owner:string;file:string;name:string;kind:Kind;editable:number;blob:string|null};
export async function getShare(token:string){return db().prepare('SELECT * FROM shares WHERE token=?').bind(token).first<Share>();}
export async function readBody(key:string){const b=await bucket().get(key);if(!b)throw new Error('Содержимое недоступно');return JSON.parse(await b.text());}
export async function bounded(req:Request){if(Number(req.headers.get('Content-Length')||0)>1500000)throw new Error('Файл слишком большой');const text=await req.text();if(text.length>1500000)throw new Error('Файл слишком большой');return JSON.parse(text);}
export function sameOrigin(req:Request){return !req.headers.get('origin')||req.headers.get('origin')===new URL(req.url).origin;}

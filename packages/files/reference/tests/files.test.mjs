import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
const dir='.sites-runtime/files-tests';mkdirSync(dir,{recursive:true});
const modules=[['features/files/presentation.ts','presentation'],['features/files/model.ts','model'],['lib/files-store.ts','store'],['app/api/files/route.ts','route']];
for(const [path,name] of modules){let source=readFileSync(path,'utf8').replaceAll("'./presentation'","'./presentation.mjs'").replaceAll("'@/features/files/model'","'./model.mjs'").replaceAll("'@/lib/files-store'","'./store.mjs'").replaceAll("'cloudflare:workers'","'./environment.mjs'").replaceAll("'@/app/chatgpt-auth'","'./auth.mjs'");writeFileSync(dir+'/'+name+'.mjs',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
writeFileSync(dir+'/environment.mjs','export const env=globalThis.testEnv;');writeFileSync(dir+'/auth.mjs','export async function getChatGPTUser(){return globalThis.testOwner?{userId:globalThis.testOwner}:null}');
const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0000_young_maestro.sql','utf8'));
function prepare(query){let args=[];const obj={bind(...v){args=v;return obj},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}};return obj;}
const blobs=new Map();globalThis.testEnv={DB:{prepare,async batch(v){sql.exec('BEGIN');try{const r=[];for(const x of v)r.push(await x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}},BUCKET:{async put(k,v){blobs.set(k,v)},async get(k){return blobs.has(k)?{text:async()=>blobs.get(k)}:null},async delete(k){blobs.delete(k)}}};
const api=await import('../'+dir+'/route.mjs'),model=await import('../'+dir+'/model.mjs');
const req=(method,body,query='')=>new Request('https://test.invalid/api/files'+query,{method,headers:{origin:'https://test.invalid','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function call(method,body,query=''){const r=await api[method](req(method,body,query));return {status:r.status,data:await r.json()}}
globalThis.testOwner=null;assert.equal((await call('GET')).status,401);
globalThis.testOwner='owner';const folder=(await call('POST',{op:'folder',name:'Учёба'})).data;
const file=(await call('POST',{op:'receive',kind:'txt',name:'Конспект',data:'Текст заметки',folder:folder.id})).data;assert.equal(file.file.name,'Конспект.txt');assert.equal((await call('GET')).data.used>0,true);
const readonly=(await call('POST',{op:'share',id:file.file.id})).data.token;
globalThis.testOwner='recipient';assert.equal((await call('GET',null,'?id='+file.file.id)).status,404);assert.equal((await call('GET')).data.files.length,0);
const shared=(await call('GET',null,'?id=shared&token='+readonly)).data;assert.equal(shared.editable,false);assert.equal(shared.data,'Текст заметки');assert.equal((await call('PUT',{id:file.file.id,token:readonly,revision:1,data:'Взлом'})).status,403);assert.equal((await call('PATCH',{id:file.file.id,changes:{name:'Взлом'}})).status,404);
const own=(await call('POST',{op:'receive',kind:'txt',name:'Моя копия',data:shared.data})).data;assert.equal(own.editable,true);
globalThis.testOwner='owner';const updated=(await call('PUT',{id:file.file.id,data:'Новый оригинал',revision:1})).data;assert.equal(updated.file.revision,2);assert.equal((await call('PUT',{id:file.file.id,data:'Старая вкладка',revision:1})).status,409);assert.equal((await call('GET',null,'?id=shared&token='+readonly)).data.data,'Текст заметки');
const edit=(await call('POST',{op:'share',id:file.file.id,editable:true})).data.token;
globalThis.testOwner='recipient';const editResult=await call('PUT',{id:file.file.id,token:edit,revision:2,data:'Работаем вместе'});assert.equal(editResult.status,200);
globalThis.testOwner='owner';assert.equal((await call('GET',null,'?id='+file.file.id)).data.data,'Работаем вместе');await call('DELETE',{token:edit});assert.equal((await call('PUT',{id:file.file.id,token:edit,revision:3,data:'Не должно сохраниться'})).status,403);
const presentation=model.newData('prsn','Слайды');assert.deepEqual(model.parseFile('Слайды.prsn',model.serialize('prsn',presentation)).data,presentation);assert.equal((await call('POST',{op:'receive',kind:'prsn',name:'Слайды',data:presentation})).status,200);assert.throws(()=>model.parseFile('photo.jpg','x'));presentation.slides[0].blocks.push({id:'image',kind:'image',text:'Фото',src:'/api/media?id=00000000-0000-0000-0000-000000000000',size:12,align:'left'});assert.equal(model.validData('prsn',presentation),false);assert.equal((await call('POST',{op:'receive',kind:'jpg',name:'Фото',data:'x'})).status,400);
await call('POST',{op:'folder',id:folder.id,remove:true});assert.equal((await call('GET',null,'?id='+file.file.id)).data.file.folder,null);
await call('PATCH',{id:file.file.id,changes:{trashed:true}});assert.equal((await call('GET',null,'?id='+file.file.id)).status,404);await call('PATCH',{id:file.file.id,changes:{trashed:false}});assert.equal((await call('GET',null,'?id='+file.file.id)).status,200);
const badOrigin=new Request('https://test.invalid/api/files',{method:'PUT',headers:{origin:'https://evil.invalid'},body:'{}'});assert.equal((await api.PUT(badOrigin)).status,403);
assert.equal(file.file.downloaded,true);
assert.equal((await call('POST',{op:'create',kind:'txt',name:'Запрещено',data:'x'})).status,400);
const renamed=await call('PATCH',{id:file.file.id,changes:{name:'Новое'}});assert.equal(renamed.data.name,'Новое.txt');
assert.equal((await call('GET',null,'?shares=1')).data[0].file,file.file.id);
assert.equal(model.withExtension('Название','Документ.future','txt'),'Название.future');
assert.equal(model.withExtension('Название.txt','Документ.txt','txt'),'Название.txt');
assert.equal(model.fileExtension('Презентация.prsn','txt'),'.prsn');
console.log('Passed: txt/prsn roundtrip, cloud CRUD, folders, ownership, read-only snapshots, editable shares, revocation, revision conflicts, media rejection, trash recovery, CSRF.');

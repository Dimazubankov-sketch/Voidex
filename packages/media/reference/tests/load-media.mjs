import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
const cache=new Map();
async function uri(name){
 if(cache.has(name))return cache.get(name);
 let source=ts.transpileModule(await fs.readFile(path.resolve('features/media',name+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const m of [...source.matchAll(/from ['"]\.\/([^'"]+)['"]/g)])source=source.replace(m[0],`from '${await uri(m[1])}'`);
 const result='data:text/javascript;base64,'+Buffer.from(source).toString('base64');cache.set(name,result);return result;
}
export async function loadMedia(name){return import(await uri(name));}

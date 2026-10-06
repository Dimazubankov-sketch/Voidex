import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
async function pure(path){const source=readFileSync(path,'utf8');const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['paintRange','selectionDirection','swipeDirection','keyboardInset','menuPlacement'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');const code=ts.transpileModule(functions,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const {paintRange,selectionDirection}=await pure('features/files/useFileSelection.ts');const {swipeDirection,keyboardInset}=await pure('features/files/FileDock.tsx');
assert.equal(selectionDirection(5,70),'scroll');assert.equal(selectionDirection(70,5),'paint');assert.equal(selectionDirection(3,4),'pending');
const ids=['a','b','c','d'];const base=new Set(['d']);assert.deepEqual([...paintRange(ids,base,0,2,false)],['d','a','b','c']);assert.deepEqual([...paintRange(ids,base,0,1,false)],['d','a','b']);assert.deepEqual([...paintRange(ids,new Set(ids),2,0,true)],['d']);assert.deepEqual([...base],['d']);
assert.equal(swipeDirection(-70,2),1);assert.equal(swipeDirection(70,2),-1);assert.equal(swipeDirection(5,70),0);assert.equal(keyboardInset(800,450,0),350);assert.equal(keyboardInset(800,780,20),0);assert.equal(keyboardInset(800,400,0,2),0);
console.log('Passed: scroll versus selection, reversible range painting, dock swipes, viewport keyboard inset.');

const {menuPlacement}=await pure('features/files/FileContextMenu.tsx');
for(const [r,w,h] of [[{left:16,right:120,top:120,bottom:330},390,844],[{left:140,right:250,top:480,bottom:680},390,844],[{left:265,right:375,top:300,bottom:500},390,844],[{left:720,right:950,top:650,bottom:900},1280,950],[{left:130,right:240,top:100,bottom:310},375,500]]){
 const p=menuPlacement(r,w,h,368),height=Math.min(368,p.maxHeight);assert.ok(p.left>=0&&p.left+p.width<=w);assert.ok(p.top>=0&&p.top+height<=h);assert.ok(p.left+p.width<=r.left||p.left>=r.right||p.top+height<=r.top||p.top>=r.bottom,'menu overlaps card');
}
console.log('Passed: context menu stays within viewport and outside the file.');

import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.join(root,'public','ocr');
await mkdir(target,{recursive:true});
const files=[
 ['tesseract.js/dist/worker.min.js','worker.min.js'],
 ['tesseract.js/dist/worker.min.js.LICENSE.txt','worker.min.js.LICENSE.txt'],
 ['tesseract.js-core/tesseract-core-lstm.wasm.js','tesseract-core-lstm.wasm.js'],
 ['tesseract.js-core/tesseract-core-lstm.wasm','tesseract-core-lstm.wasm'],
 ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js'],
 ['tesseract.js-core/tesseract-core-simd-lstm.wasm','tesseract-core-simd-lstm.wasm'],
 ['@tesseract.js-data/eng/4.0.0/eng.traineddata.gz','eng.traineddata.gz'],
];
for(const [source,destination] of files)await copyFile(path.join(root,'node_modules',source),path.join(target,destination));
console.log('OCR: все 7 файлов восстановлены из установленных зависимостей.');

import fs from 'node:fs/promises';import {loadMedia} from './load-media.mjs';const {zipFiles}=await loadMedia('media-utils');
const b=await zipFiles([new File(['hello'],'test.txt'),new File([new Uint8Array([0,1,255])],'фото.bin')]);await fs.writeFile('/tmp/media-test.zip',new Uint8Array(await b.arrayBuffer()));console.log('Created ZIP sample');

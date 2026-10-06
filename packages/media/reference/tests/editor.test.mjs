import assert from 'node:assert/strict';
import {loadMedia} from './load-media.mjs';
const {applyColor}=await loadMedia('edit-color');const {freshEdit,filters}=await loadMedia('media-utils');const {videoSize,trimRange}=await loadMedia('video-utils');const {paintRange}=await loadMedia('selection');
const input=new Uint8ClampedArray([200,50,10,255,20,130,210,80,80,90,140,255]);
let pixels=input.slice();applyColor(pixels,freshEdit());assert.deepEqual(pixels,input);
pixels=input.slice();applyColor(pixels,{...freshEdit(),brightness:0});assert.deepEqual([...pixels],[0,0,0,255,0,0,0,80,0,0,0,255]);
pixels=input.slice();applyColor(pixels,{...freshEdit(),grayscale:100});for(let i=0;i<pixels.length;i+=4){assert.equal(pixels[i],pixels[i+1]);assert.equal(pixels[i],pixels[i+2]);assert.equal(pixels[i+3],input[i+3]);}
const hashes=new Set();for(const [id,,patch] of filters){pixels=input.slice();applyColor(pixels,{...freshEdit(),...patch});if(id!=='original')assert.notDeepEqual(pixels,input);hashes.add(pixels.toString());}assert.equal(hashes.size,filters.length);
assert.deepEqual(videoSize(1920,1080,freshEdit()),{width:1280,height:720});assert.deepEqual(videoSize(1920,1080,{...freshEdit(),rotation:90}),{width:720,height:1280});assert.deepEqual(trimRange(-2,99,10),[0,10]);assert.ok(trimRange(12,1,10)[1]<=10);
const ids=['a','b','c','d','e'],base=new Set(['e']);assert.deepEqual([...paintRange(ids,base,1,3,false)],['e','b','c','d']);assert.deepEqual([...paintRange(ids,base,1,1,false)],['e','b']);assert.deepEqual([...base],['e']);assert.deepEqual([...paintRange(ids,new Set(ids),1,3,true)],['a','e']);
const {seedLibrary,validLibrary}=await loadMedia('model');const lib=seedLibrary(),video=lib.items.find(m=>m.kind==='video');Object.assign(video,{originalDuration:6,duration:2,edited:true});assert.ok(validLibrary(lib));video.originalDuration=-2;assert.ok(!validLibrary(lib));
console.log('13 distinct filters, pixel correction without Canvas.filter, alpha preservation, video crop/rotation/trim, reversible swipe selection and original duration validation passed.');

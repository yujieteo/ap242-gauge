// Builds dist/ap242-gauge.html: one offline file with occt-import-js (JS + base64 wasm),
// src/geom.js and src/app.js inlined. The output is deterministic, so CI can compare it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const occt = 'node_modules/occt-import-js/';
const version = JSON.parse(read(occt + 'package.json')).version;
if (version !== '0.0.23') throw new Error('expected occt-import-js 0.0.23, found ' + version);

const script = (s) => s.replace(/<\/script/gi, '<\\/script');
const html = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const wasm = read(occt + 'dist/occt-import-js.wasm').toString('base64');
const licences = [
  '==== occt-import-js ' + version + ' (dist/license.occt-import-js.txt) ====',
  read(occt + 'dist/license.occt-import-js.txt').toString(),
  '==== Open CASCADE Technology (dist/license.occt.txt) ====',
  read(occt + 'dist/license.occt.txt').toString(),
].join('\n');

const parts = {
  '/*LICENCES*/': html(licences),
  '/*OCCT_JS*/': script(read(occt + 'dist/occt-import-js.js').toString()),
  '/*GEOM_JS*/': script(read('src/geom.js').toString()),
  '/*WASM_B64*/': wasm,
  '/*APP_JS*/': script(read('src/app.js').toString()),
};
let out = read('src/index.html').toString();
for (const [mark, text] of Object.entries(parts)) {
  if (out.split(mark).length !== 2) throw new Error('template must hold ' + mark + ' once');
  out = out.replace(mark, () => text);
}
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/ap242-gauge.html', root), out);
console.log('dist/ap242-gauge.html', (out.length / 1e6).toFixed(2), 'MB');

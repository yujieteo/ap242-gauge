import { mkdirSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const OCCT_VERSION = '0.0.23';
const OCCT_DIR = 'node_modules/occt-import-js/';
const OUTPUT = 'dist/ap242-gauge.html';

const read = (p: string): Promise<string> => Bun.file(new URL(p, root)).text();

function parsePackageField(json: unknown, name: string): string {
  if (typeof json !== 'object' || json === null) throw new Error('package.json is not an object');
  const value: unknown = Reflect.get(json, name);
  if (typeof value !== 'string') throw new Error('package.json has no string field ' + name);
  return value;
}

const wantedBun = parsePackageField(JSON.parse(await read('package.json')), 'packageManager');
if (wantedBun !== 'bun@' + Bun.version) throw new Error('package.json packageManager is ' + wantedBun + ', running bun@' + Bun.version);
const occtVersion = parsePackageField(JSON.parse(await read(OCCT_DIR + 'package.json')), 'version');
if (occtVersion !== OCCT_VERSION) throw new Error('expected occt-import-js ' + OCCT_VERSION + ', found ' + occtVersion);

const script = (s: string): string => s.replace(/<\/script/gi, '<\\/script');
const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const html = (s: string): string => s.replace(/[&<>]/g, (c) => HTML_ESCAPES[c] ?? c);

async function bundle(entry: string): Promise<string> {
  const built = await Bun.build({ entrypoints: [new URL(entry, root).pathname], root: new URL('.', root).pathname, target: 'browser', format: 'iife', minify: false });
  if (!built.success) throw new AggregateError(built.logs, 'bundling ' + entry + ' failed');
  const [output] = built.outputs;
  if (!output || built.outputs.length !== 1) throw new Error('expected one bundle output for ' + entry);
  return output.text();
}

const base64 = async (p: string): Promise<string> => Buffer.from(await Bun.file(new URL(p, root)).arrayBuffer()).toString('base64');

const licences = [
  '==== occt-import-js ' + occtVersion + ' (dist/license.occt-import-js.txt) ====',
  await read(OCCT_DIR + 'dist/license.occt-import-js.txt'),
  '==== Open CASCADE Technology (dist/license.occt.txt) ====',
  await read(OCCT_DIR + 'dist/license.occt.txt'),
  '==== Inter typeface (src/fonts/inter-OFL.txt) ====',
  await read('src/fonts/inter-OFL.txt'),
].join('\n');

const parts: Readonly<Record<string, string>> = {
  '@@LICENCES@@': html(licences),
  '@@OCCT_JS@@': script(await read(OCCT_DIR + 'dist/occt-import-js.js')),
  '@@WORKER_JS@@': script(await bundle('src/reader.worker.ts')),
  '@@WASM_B64@@': await base64(OCCT_DIR + 'dist/occt-import-js.wasm'),
  '@@INTER_B64@@': await base64('src/fonts/inter.woff2'),
  '@@APP_JS@@': script(await bundle('src/app.ts')),
};
let out = await read('src/index.html');
for (const [mark, text] of Object.entries(parts)) {
  if (out.split(mark).length !== 2) throw new Error('template must hold ' + mark + ' once');
  out = out.replace(mark, () => text);
}
mkdirSync(new URL('dist/', root), { recursive: true });
await Bun.write(new URL(OUTPUT, root), out);
console.log(OUTPUT, (out.length / 1e6).toFixed(2), 'MB');

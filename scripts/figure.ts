import { existsSync, readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const SKILLS = join(homedir(), '.claude', 'skills');
const figureEngine = process.env['AP242_SCHEMATIC_FIGURE'] ?? join(SKILLS, 'schematic-figure');
const emilStyle = process.env['AP242_SCHEMATIC_EMIL'] ?? join(SKILLS, 'schematic-emil');
const SOURCE = 'docs/figures/face-fit.ts';
const COMMITTED = join(root, 'docs/figures/face-fit.svg');

const project = mkdtempSync(join(tmpdir(), 'ap242-figure-'));
const figures = join(project, 'docs', 'figures');
mkdirSync(figures, { recursive: true });
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const utilJs = transpiler.transformSync(readFileSync(join(root, 'src/util.ts'), 'utf8'));
mkdirSync(join(project, 'src'));
writeFileSync(join(project, 'src', 'util.js'), utilJs);
const figureJs = transpiler.transformSync(readFileSync(join(root, SOURCE), 'utf8')).replace('../../src/util.ts', '../../src/util.js');
writeFileSync(join(figures, 'face-fit.js'), figureJs);
writeFileSync(join(figures, 'emil.js'), readFileSync(join(emilStyle, 'style.js')));
mkdirSync(join(figures, 'fonts'));
for (const font of readdirSync(join(emilStyle, 'fonts'))) writeFileSync(join(figures, 'fonts', font), readFileSync(join(emilStyle, 'fonts', font)));

const render = Bun.spawnSync(['node', join(figureEngine, 'foundation/tools/render.mjs'), '--root', project, '--fig', join(figures, 'face-fit.js'), '--no-pdf'], { stdout: 'inherit', stderr: 'inherit' });
if (render.exitCode !== 0) throw new Error('the figure engine failed');
const rendered = readFileSync(join(figures, 'out', 'face-fit.svg'));
rmSync(project, { recursive: true, force: true });
if (process.argv.includes('--write')) {
  writeFileSync(COMMITTED, rendered);
  console.log('wrote', COMMITTED);
} else if (!existsSync(COMMITTED) || !rendered.equals(readFileSync(COMMITTED))) {
  console.error('the rendered figure differs from docs/figures/face-fit.svg; run with --write after you review it');
  process.exit(1);
} else console.log('docs/figures/face-fit.svg matches the figure source');

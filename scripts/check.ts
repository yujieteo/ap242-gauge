const root = new URL('..', import.meta.url).pathname;
const failures: string[] = [];

function run(name: string, cmd: string[]): void {
  console.log('\n== ' + name);
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) failures.push(name);
}

run('type check', ['node_modules/.bin/tsc', '--noEmit']);
run('dead code', ['node_modules/.bin/knip']);
run('tests', ['bun', 'test']);
run('build', ['bun', 'run', 'build.ts']);

if (failures.length) {
  console.error('\ncheck failed: ' + [...new Set(failures)].join(', '));
  process.exit(1);
}
console.log('\ncheck passed');

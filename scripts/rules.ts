import ts from 'typescript';

export const EXCLUDED_PATHS: readonly string[] = ['dist/', 'node_modules/', 'test/data/', 'test/__snapshots__/', 'docs/figures/face-fit.svg', 'bun.lock'];
export const HOT_FILE = /\.hot\.ts$/;

export type Violation = { readonly line: number; readonly text: string };

export const isExcluded = (path: string): boolean => EXCLUDED_PATHS.some((p) => path === p || (p.endsWith('/') && path.startsWith(p)));

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function lineOf(file: ts.SourceFile, pos: number): number {
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

const ALLOCATING: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.NewExpression,
]);

export function hotAllocations(source: string): Violation[] {
  const file = parse(source);
  const found: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ALLOCATING.has(node.kind)) found.push({ line: lineOf(file, node.getStart(file)), text: ts.SyntaxKind[node.kind] + ': ' + node.getText(file).slice(0, 60) });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

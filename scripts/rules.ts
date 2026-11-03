import ts from 'typescript';

export const EXCLUDED_PATHS: readonly string[] = ['dist/', 'node_modules/', 'test/data/', 'test/__snapshots__/', 'docs/figures/face-fit.svg', 'bun.lock'];
export const HOT_FILE = /\.hot\.ts$/;

export type Violation = { readonly line: number; readonly text: string };

export const isExcluded = (path: string): boolean => EXCLUDED_PATHS.some((p) => path === p || (p.endsWith('/') && path.startsWith(p)));

const LINKS_TO_OUTSIDE_SOURCE = /https?:\/\/\S+/;

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function lineOf(file: ts.SourceFile, pos: number): number {
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

export function tsComments(source: string): Violation[] {
  const file = parse(source);
  const seen = new Set<number>();
  const found: Violation[] = [];
  const collect = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const text = source.slice(range.pos, range.end);
      if (!LINKS_TO_OUTSIDE_SOURCE.test(text)) found.push({ line: lineOf(file, range.pos), text });
    }
  };
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(source, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return found.sort((a, b) => a.line - b.line);
}

export async function htmlComments(source: string): Promise<Violation[]> {
  const found: Violation[] = [];
  let styleText = '';
  const rewriter = new HTMLRewriter()
    .onDocument({
      comments(comment) {
        if (!LINKS_TO_OUTSIDE_SOURCE.test(comment.text)) found.push({ line: 0, text: '<!--' + comment.text + '-->' });
      },
    })
    .on('style', { text(chunk) { styleText += chunk.text; } });
  await rewriter.transform(new Response(source)).text();
  if (styleText.includes('/*')) found.push({ line: 0, text: 'comment in a style element' });
  return found;
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

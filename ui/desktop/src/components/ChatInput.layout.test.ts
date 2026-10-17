import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = ts.createSourceFile(
  'ChatInput.tsx',
  readFileSync(resolve('src/components/ChatInput.tsx'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function jsxNodes(name: string) {
  const matches: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === name
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

describe('ChatInput action bar layout', () => {
  it('renders one directory switcher after the right-side indicators and no extension selector', () => {
    const directories = jsxNodes('DirSwitcher');
    expect(directories).toHaveLength(1);
    expect(jsxNodes('BottomMenuExtensionSelection')).toHaveLength(0);
    const directory = directories[0];
    expect(directory.getStart(source)).toBeGreaterThan(
      jsxNodes('ContextWindowIndicator')[0].getStart(source)
    );
    expect(directory.getStart(source)).toBeGreaterThan(
      jsxNodes('ModelsBottomBar')[0].getStart(source)
    );
    expect(directory.getStart(source)).toBeLessThan(
      jsxNodes('GitBranchIndicator')[0].getStart(source)
    );
    const attributes = directory.attributes.getText(source);
    expect(attributes).toContain('workingDir={currentWorkingDir}');
    expect(attributes).toContain('onWorkingDirChange');
    expect(attributes).toContain('setWorkingDirOverride(newDir)');
    let ancestor: ts.Node | undefined = directory.parent;
    while (ancestor && !ts.isJsxExpression(ancestor)) ancestor = ancestor.parent;
    expect(ancestor?.getText(source)).toContain('!isBottomBarNarrow');
  });
});

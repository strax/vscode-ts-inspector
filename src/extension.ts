// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path";
import * as ts from "typescript";
import { EventEmitter, ExtensionContext, Position, ProviderResult, Range, TextDocument, TextDocumentContentChangeEvent, ThemeColor, TreeDataProvider, TreeItem, TreeItemCollapsibleState, window, workspace } from 'vscode';

async function getCompilerInstance(): Promise<typeof ts | undefined> {
  const rootPath = workspace.workspaceFolders![0].uri.fsPath;
  const tsdk = path.join(rootPath, "node_modules", "typescript", "lib");
  const tsdkPath = path.join(tsdk, "typescript.js");
  try {
    return import(tsdkPath);
  } catch {
    window.showErrorMessage("Unable to locate a local TypeScript installation.");
  }
}

function offsetToPosition(sourceFile: ts.SourceFile, offset: number) {
  const {line, character} = ts.getLineAndCharacterOfPosition(sourceFile, offset);
  return new Position(line, character);
}

function nodeToRange(sourceFile: ts.SourceFile, node: ts.Node): Range {
  const start = offsetToPosition(sourceFile, node.getStart(sourceFile));
  const end = offsetToPosition(sourceFile, node.getEnd());
  return new Range(start, end);
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {
  const disposables = context.subscriptions;
  const ts = await getCompilerInstance();
  if (!ts) {
    return;
  }
  const provider = new ASTProvider(ts);
  const view = window.createTreeView("typescript-inspector.ast", { showCollapseAll: true, treeDataProvider: provider });
  let visible = view.visible;
  disposables.push(view);


  let activeTextEditor = window.activeTextEditor;
  const highlightColor = new ThemeColor("editor.findMatchBackground");
  const highlightBorder = new ThemeColor("editor.findMatchBorder");
  const decoration = window.createTextEditorDecorationType({ backgroundColor: highlightColor, borderColor: highlightBorder, borderWidth: "1px", borderStyle: "solid" });

  function clearDecorations() {
    if (activeTextEditor) {
      activeTextEditor.setDecorations(decoration, []);
    }
  }

  function setDecorations(nodes: ts.Node[]) {
    if (activeTextEditor) {
      const ranges = nodes.map(node => nodeToRange(provider.sourceFile!, node));
      activeTextEditor.setDecorations(decoration, ranges);
    }
  }

  view.onDidChangeVisibility(evt => {
    visible = evt.visible;
    if (!visible) {
      clearDecorations();
    } else {
      setDecorations(view.selection);
    }
  }, undefined, disposables);

  view.onDidChangeSelection(evt => {
    setDecorations(evt.selection);
  }, undefined, disposables);

  workspace.onDidChangeTextDocument(evt => {
    if (activeTextEditor && evt.document === activeTextEditor.document) {
      provider.parse();
    }
  });

  window.onDidChangeActiveTextEditor(editor => {
    if (editor && view.visible) {
      provider.source = editor.document;
    } else {
      provider.source = undefined;
    }
    activeTextEditor = editor;
  }, undefined, disposables);

  if (activeTextEditor) {
    provider.source = activeTextEditor.document;
  }
}

class ASTProvider implements TreeDataProvider<ts.Node> {
  sourceFile?: ts.SourceFile;
  private document?: TextDocument;

  private onChange: EventEmitter<ts.Node | undefined> = new EventEmitter<ts.Node | undefined>();

  get onDidChangeTreeData() {
    return this.onChange.event;
  }

  set source(document: TextDocument | undefined) {
    this.document = document;
    if (this.document) {
      this.parse();
    } else {
      this.sourceFile = undefined;
      this.onChange.fire();
    }
  }

  constructor(private compiler: typeof ts) {
  }

  parse(): void {
    this.sourceFile = this.compiler.createSourceFile(this.document!.fileName, this.document!.getText(), this.compiler.ScriptTarget.Latest); 
    this.onChange.fire();
  }

  update(changes: TextDocumentContentChangeEvent[]) {
    if (!this.sourceFile) {
      this.parse();
    } else {
      for (const change of changes) {
        this.sourceFile.update(change.text, {newLength: change.text.length, span: {length: change.rangeLength, start: change.rangeOffset}})
      }
      this.onChange.fire();
    }
  }

  private showNode(node: ts.Node): string {
    const kind = this.compiler.SyntaxKind[node.kind];
    return `${kind}(${node.pos}..${node.end})`;
  }

  private showDescription(node: ts.Node): string | boolean {
    if (this.compiler.isIdentifier(node)) {
      return node.getText(this.sourceFile);
    } else {
      return false;
    }
  }

  private collapsibleStateForNode(node: ts.Node) {
    if (node.getChildCount(this.sourceFile) > 0) {
      return TreeItemCollapsibleState.Collapsed;
    } else {
      return TreeItemCollapsibleState.None;
    }
  }

  getTreeItem(node: ts.Node): TreeItem {
    return { label: this.showNode(node), collapsibleState: this.collapsibleStateForNode(node), description: this.showDescription(node) };
  }
  getChildren(node?: ts.Node): ProviderResult<ts.Node[]> {
    if (!this.sourceFile) {
      return [];
    }
    if (!node) {
      return this.sourceFile.getChildren();
    }
    return node.getChildren(this.sourceFile);
  }
}

// this method is called when your extension is deactivated
export function deactivate() {}

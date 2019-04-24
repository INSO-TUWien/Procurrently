// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as crdt from './lib/crdt';
import { ContributorsTreeView } from './ContributorsTreeView';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	vscode.workspace.onDidOpenTextDocument(crdt.registerFile);
	crdt.registerFile(vscode.window.activeTextEditor.document);
	/* const edit = new vscode.WorkspaceEdit();
        edit.replace(vscode.Uri.file('/Users/stefangussner/git/sync-element/sync-element.js'), new vscode.Range(new vscode.Position(255,51), new vscode.Position(255,51)),'asdf');
		vscode.workspace.applyEdit(edit); */
	//vscode.window.onDidChangeTextEditorSelection(crdt.cursorPositionChanged);
	vscode.workspace.onDidChangeTextDocument(crdt.onLocalChange);

	const treeview = new ContributorsTreeView(crdt.getUsers);
	vscode.window.registerTreeDataProvider('contributors', treeview);
	crdt.setUserUpdatedCallback(treeview.refresh);

	vscode.commands.registerCommand('stageChanges',(args)=>{
		console.log(args)
	})
}

// this method is called when your extension is deactivated
export function deactivate() {}

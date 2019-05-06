// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as Crdt from './lib/crdt';
import { ContributorsTreeView } from './ContributorsTreeView';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const crdt = await Crdt.default(context.globalState.get('procurrently.siteId'), context.globalState.get('procurrently.allChanges') ? JSON.parse(context.globalState.get('procurrently.allChanges')):null);
	context.globalState.update('procurrently.siteId', crdt.siteId);

	vscode.workspace.onDidOpenTextDocument(crdt.registerFile);
	if (vscode.window.activeTextEditor) {
		crdt.registerFile(vscode.window.activeTextEditor.document);
	}
	/* const edit = new vscode.WorkspaceEdit();
        edit.replace(vscode.Uri.file('/Users/stefangussner/git/sync-element/sync-element.js'), new vscode.Range(new vscode.Position(255,51), new vscode.Position(255,51)),'asdf');
		vscode.workspace.applyEdit(edit); */
	//vscode.window.onDidChangeTextEditorSelection(crdt.cursorPositionChanged);
	vscode.workspace.onDidChangeTextDocument(crdt.onLocalChange);

	const treeview = new ContributorsTreeView(crdt.getUsers);
	vscode.window.registerTreeDataProvider('contributors', treeview);
	crdt.setUserUpdatedCallback(treeview.refresh);

	vscode.commands.registerCommand('stageChanges', siteId => {
		crdt.toggleStageChangesBySiteId(siteId);
	});

	vscode.commands.registerCommand('procurrently.checkoutBranch', () => {
		crdt.switchBranch();
	});

	vscode.commands.registerCommand('procurrently.toggleRemoteChanges', () => {
		crdt.toggleRemoteChangesVisible();
	});

	vscode.commands.registerCommand('procurrently.togglePauseChanges', () => {
		crdt.togglePauseChanges();
	});

	crdt.setSaveCallback(() => {
		context.globalState.update('procurrently.allChanges', JSON.stringify(crdt.getAllChanges()));
	});
}

// this method is called when your extension is deactivated
export function deactivate() { }

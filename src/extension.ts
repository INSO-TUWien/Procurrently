// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as Git from './lib/Git';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	console.log('decorator sample is activated');
	vscode.workspace.onDidChangeTextDocument(async change=>{
		console.log(JSON.stringify(change.contentChanges));
		try{
			console.log(await Git.getCurrentFileVersion(change.document.fileName));
		}catch(e){
			console.error(e);
		}
		// console.log(repo);
		// console.log(await repo.getMasterCommit()); 
	});
}

// this method is called when your extension is deactivated
export function deactivate() {}

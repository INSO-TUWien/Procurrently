import {
    Document,
    serializeOperation, deserializeOperation,
    serializeRemotePosition, deserializeRemotePosition
} from '@atom/teletype-crdt';
import Network from './network';
import * as Git from './git';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import setText from 'vscode-set-text';

//setup peer to peer connection
const net = new Network();
net.onRemoteEdit(onRemteChange);

const documents = new Map<string, {document:Document, metaData:{branch:string, repo:string, file:string}}>();

export async function onLocalChange(e: vscode.TextDocumentChangeEvent) {
    if (!documents.has(e.document.fileName)) {
        console.log('Oh no... this is not good...');
        await registerFile(e.document);
    }else{
        const doc = documents.get(e.document.fileName);
        if(e.document.getText()==doc.document.getText()){
            //we know about this change
            return;
        }
        const operations = [];
        for(let change of e.contentChanges){
            operations.push(...doc.document.setTextInRange({row:change.range.start.line, column:change.range.start.character},{row:change.range.end.line, column:change.range.end.character}, change.text));
        }
        net.sendUpdate({metaData:doc.metaData,operations});
    }

}

export async function onRemteChange({metaData, operations}) {
    const filepath = `${vscode.workspace.rootPath}${metaData.file}`;
    const localdoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`file://${filepath}`));
    //todo check meta file and branch
    if (!documents.has(filepath)) {
        console.log('unknown remote file discovered');
        const metaData = Object.freeze({
            branch: (await Git.getCurrentBranch(filepath)),
            repo: (await Git.getRepoUrl(filepath)),
            file: (await Git.getFilePathRelativeToRepo(filepath))
        });

        const document = new Document({ siteId: 1, text: (await Git.getCurrentFileVersion(filepath)) }).replicate(net.siteId);
        
        //check for local modifications already present
        //this solution is just a placeholder
        const docText = localdoc.getText();
        document.setTextInRange(0,document.getText().length,docText);

        documents.set(filepath, {
            document,
            metaData
        });
    }

    const textOperations = documents.get(filepath).document.integrateOperations(operations);
    console.log(textOperations);
    const edit = new vscode.WorkspaceEdit();
    for(let o of textOperations.textUpdates){
        edit.replace(vscode.Uri.file(filepath), new vscode.Range(new vscode.Position(o.oldStart.row, o.oldStart.column) , new vscode.Position(o.oldEnd.row, o.oldEnd.column)),o.newText);
        console.log(`${o.oldStart.row},${o.oldStart.column}:'${o.newText}'`)
    }
    vscode.workspace.applyEdit(edit);
    if(metaData.cursorPosition){
        console.log(metaData.cursorPosition);
    }
}

export async function cursorPositionChanged(e:vscode.TextEditorSelectionChangeEvent){
    if(e.selections.length==1){
        registerFile(e.textEditor.document);
        const metaData = {cursorPosition: {line:e.selections[0].active.line, character:e.selections[0].active.character},...documents.get(e.textEditor.document.fileName).metaData};
        net.sendUpdate({operations:[], metaData});
    }

}

export async function registerFile(file:vscode.TextDocument){
    if (!documents.has(file.fileName)) {
        try{
            const metaData = Object.freeze({
                branch: (await Git.getCurrentBranch(file.fileName)),
                repo: (await Git.getRepoUrl(file.fileName)),
                file: (await Git.getFilePathRelativeToRepo(file.fileName))
            });
    
            //pretend the initial doc came from the same source
            const document = new Document({ siteId: 1, text: (await Git.getCurrentFileVersion(file.fileName)) }).replicate(net.siteId);
            
            //check for local modifications already present
            //this solution is just a placeholder
            // const docText = file.getText();
            // document.setTextInRange(0,document.getText().length,docText);
    
            documents.set(file.fileName, {
                document,
                metaData
            });
            console.log('registered '+metaData.file);
        }catch(e){
            //some files opened might not be in a git repo...
            console.warn(e);
        }
    }
}
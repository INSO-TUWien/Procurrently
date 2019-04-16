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
        const metaData = Object.freeze({
            branch: (await Git.getCurrentBranch(e.document.fileName)),
            repo: (await Git.getRepoUrl(e.document.fileName)),
            file: (await Git.getFilePathRelativeToRepo(e.document.fileName))
        });

        const document = new Document({ siteId: net.siteId, text: (await Git.getCurrentFileVersion(e.document.fileName)) });
        
        //check for local modifications already present
        //this solution is just a placeholder
        const docText = e.document.getText();
        document.setTextInRange(0,document.getText().length,docText);

        documents.set(e.document.fileName, {
            document,
            metaData
        });
    }else{
        const doc = documents.get(e.document.fileName);
        const operations = [];
        for(let change of e.contentChanges){
            operations.push(...doc.document.setTextInRange(change.range.start, change.range.end, change.text));
        }
        net.sendUpdate({metaData:doc.metaData,operations});
    }

}

export async function onRemteChange({metaData, operations}) {
    const filepath = `${vscode.workspace.rootPath}${metaData.file}`;
    const localdoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`file:///${filepath}`));
    //todo check meta file and branch
    if (!documents.has(filepath)) {
        const metaData = Object.freeze({
            branch: (await Git.getCurrentBranch(filepath)),
            repo: (await Git.getRepoUrl(filepath)),
            file: (await Git.getFilePathRelativeToRepo(filepath))
        });

        const document = new Document({ siteId: net.siteId, text: (await Git.getCurrentFileVersion(filepath)) });
        
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
}

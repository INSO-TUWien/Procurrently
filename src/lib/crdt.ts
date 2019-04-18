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

const documents = new Map<string, { document: Document, metaData: { branch: string, repo: string, file: string } }>();

//remote changes that have not fired a localchangeevent yet
const currentChanges = [];

export async function onLocalChange(e: vscode.TextDocumentChangeEvent) {
    if (!documents.has(e.document.fileName)) {
        console.log('Oh no... this is not good...');
        await registerFile(e.document);
    } else {
        const doc = documents.get(e.document.fileName);
        const operations = [];
        for (let change of e.contentChanges) {
            const objects = ['start', 'end'];
            const props = ['line', 'character'];

            //check if this change has just been added by remote
            const knownChanges = currentChanges.filter(c => objects.map(o => props.map(p => c[o][p] == change.range[o][p])) && c.text == change.text);
            if (knownChanges.length > 0) {
                //remove from known changes
                currentChanges.splice(currentChanges.indexOf(knownChanges[0]));
            } else {
                operations.push(...doc.document.setTextInRange({ row: change.range.start.line, column: change.range.start.character }, { row: change.range.end.line, column: change.range.end.character }, change.text));
            }
        }
        net.sendUpdate({ metaData: doc.metaData, operations });
    }

}

export async function onRemteChange({ metaData, operations }) {
    const filepath = `${vscode.workspace.rootPath}${metaData.file}`;
    //todo check meta file and branch
    if (!documents.has(filepath)) {
        const localdoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`file://${filepath}`));
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
        document.setTextInRange(0, document.getText().length, docText);

        documents.set(filepath, {
            document,
            metaData
        });
    }

    const textOperations = documents.get(filepath).document.integrateOperations(operations);
    console.log(textOperations);
    const edit = new vscode.WorkspaceEdit();
    for (let o of textOperations.textUpdates) {
        edit.replace(vscode.Uri.file(filepath), new vscode.Range(new vscode.Position(o.oldStart.row, o.oldStart.column), new vscode.Position(o.oldEnd.row, o.oldEnd.column)), o.newText);
        currentChanges.push({ start: { line: o.oldStart.row, character: o.oldStart.column }, end: { line: o.oldEnd.row, character: o.oldEnd.column }, text: o.newText });
        console.log(`${o.oldStart.row},${o.oldStart.column}:'${o.newText}'`)
    }
    vscode.workspace.applyEdit(edit);
    if (metaData.cursorPosition) {
        console.log(metaData.cursorPosition);
    }
}

export async function cursorPositionChanged(e: vscode.TextEditorSelectionChangeEvent) {
    if (e.selections.length == 1) {
        registerFile(e.textEditor.document);
        const metaData = { cursorPosition: { line: e.selections[0].active.line, character: e.selections[0].active.character }, ...documents.get(e.textEditor.document.fileName).metaData };
        net.sendUpdate({ operations: [], metaData });
    }

}

export async function registerFile(file: vscode.TextDocument) {
    if (!documents.has(file.fileName)) {
        try {
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
            console.log('registered ' + metaData.file);
        } catch (e) {
            //some files opened might not be in a git repo...
            console.warn(e);
        }
    }
}
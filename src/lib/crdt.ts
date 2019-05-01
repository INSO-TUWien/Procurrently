import {
    Document,
    serializeOperation, deserializeOperation,
    serializeRemotePosition, deserializeRemotePosition
} from '@atom/teletype-crdt';
import Network from './network';
import * as Git from './git';
import * as vscode from 'vscode';
import { User } from '../ContributorsTreeView';
import { watchFile } from 'fs';

export default async (siteId?:number) => {
    await vscode.workspace.saveAll(true);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await Git.reset(vscode.workspace.rootPath + '/a');

    //setup peer to peer connection
    const net = new Network(siteId);
    net.onRemoteEdit(onRemteChange);
    net.setDataProviderCallback(getAllChanges);

    const documents = new Map<string, { document: Document, metaData: { commit: string, branch: string, repo: string, file: string, users: Map<Number, string> } }>();
    /** remote repository to path mapping */
    const localPaths = new Map<string, string>();
    /** The current branch for a file */
    const branches = new Map<string, string>();

    /**
     * retrieves a document by it's metadata. If only a filename is given will return the current local version
     * @param filename the filename
     * @param commit the HEAD commit
     * @param branch the Branch
     * @param repo The remote repository url
     */

    function getSpecifier(commit: string, branch: string, repo: string) {
        return `@${commit}@${branch}@${repo}`;
    }

    function getLocalDocument(filename: string, commit?: string, branch?: string, repo?: string) {
        let key;
        if (commit && branch && repo) {
            key = filename + getSpecifier(commit, branch, repo);
        }
        else if (branches.has(filename)) {
            key = filename + branches.get(filename);
        }
        else {
            return null;
        }
        return documents.get(key);
    }

    function setLocalDocument(document, filename: string, commit: string, branch: string, repo: string) {
        const specifier = getSpecifier(commit, branch, repo);
        documents.set(`${filename}${specifier}`, document);
    }


    //remote changes that have not fired a localchangeevent yet
    const currentChanges = [];

    async function onLocalChange(e: vscode.TextDocumentChangeEvent) {
        if (!getLocalDocument(e.document.fileName)) {
            if (await Git.isIgnored(e.document.fileName)) {
                return;
            }
            await registerFile(e.document);
        } else {
            const doc = getLocalDocument(e.document.fileName);
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
                    console.info('local change: ' + JSON.stringify({ start: { row: change.range.start.line, column: change.range.start.character }, end: { row: change.range.end.line, column: change.range.end.character }, text: change.text }));
                    operations.push(...doc.document.setTextInRange({ row: change.range.start.line, column: change.range.start.character }, { row: change.range.end.line, column: change.range.end.character }, change.text));
                }
            }
            if (operations.length > 0) {
                net.sendUpdate({ metaData: doc.metaData, operations, authors: Array.from(doc.metaData.users) });
                save();
            }
        }
    }

    
    //for pausing remote changes
    let pendingRemoteChanges = Promise.resolve();
    async function onRemteChange({ metaData, operations, authors }) {
        const filepath = `${localPaths.has(metaData.repo) ? localPaths.get(metaData.repo) : vscode.workspace.rootPath}${metaData.file}`;
        //todo check meta file and branch
        if (!getLocalDocument(filepath, metaData.commit, metaData.branch, metaData.repo)) {
            const localdoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`file://${filepath}`));
            await registerFile(localdoc, metaData.branch, metaData.commit, metaData.repo);
        }

        const localMetaData = getLocalDocument(filepath, metaData.commit, metaData.branch, metaData.repo).metaData;
        if (authors) {
            for (let [siteId, name] of new Map<Number, string>(authors)) {
                if (!localMetaData.users.has(siteId)) {
                    localMetaData.users.set(siteId, name);
                    if (usersChanged) {
                        usersChanged();
                    }
                }
            }
        }
        

        //only apply changes if on the same branch and remote changes visible
        if (branches.get(filepath) == getSpecifier(metaData.commit, metaData.branch, metaData.repo) && remoteChangesVisible) {
            const doc = getLocalDocument(filepath).document;
            const textOperations = doc.integrateOperations(operations);
            if (doc.deferredOperationsByDependencyId.size > 0) {
                net.requestRemoteOperations();
            }
            try {
                await pendingRemoteChanges.then(() => applyEditToLocalDoc(filepath, textOperations));
            } catch (e) {
                console.error(e);
            }
        } else {
            //save changes to other files
            getLocalDocument(filepath, metaData.commit, metaData.branch, metaData.repo).document.integrateOperations(operations);
        }
        save();
    }

    async function applyEditToLocalDoc(filepath: string, textOperations) {
        for (let o of textOperations.textUpdates.sort((a, b) => b.oldStart.column - a.oldStart.column)) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(vscode.Uri.file(filepath), new vscode.Range(new vscode.Position(o.oldStart.row, o.oldStart.column), new vscode.Position(o.oldEnd.row, o.oldEnd.column)), o.newText);
            currentChanges.push({ start: { line: o.oldStart.row, character: o.oldStart.column }, end: { line: o.oldEnd.row, character: o.oldEnd.column }, text: o.newText });
            await vscode.workspace.applyEdit(edit);
        }
    }

    async function cursorPositionChanged(e: vscode.TextEditorSelectionChangeEvent) {
        if (e.selections.length == 1) {
            registerFile(e.textEditor.document);
            const metaData = { cursorPosition: { line: e.selections[0].active.line, character: e.selections[0].active.character }, ...getLocalDocument(e.textEditor.document.fileName).metaData };
            net.sendUpdate({ operations: [], metaData });
        }
    }

    

    async function registerFile(file: vscode.TextDocument, branch?: string, commit?: string, repo?: string) {
        if (!branch) {
            branch = await Git.getCurrentBranch(file.fileName);
        }
        if (!commit) {
            commit = await Git.getCurrentCommitHash(file.fileName);
        }
        if (!repo) {
            repo = await Git.getRepoUrl(file.fileName);
        }

        if (!getLocalDocument(file.fileName, commit, branch, repo)) {
            try {
                const metaData = Object.freeze({
                    branch,
                    commit,
                    repo,
                    file: (await Git.getFilePathRelativeToRepo(file.fileName)),
                    users: new Map()
                });
                branches.set(file.fileName, getSpecifier(await Git.getCurrentCommitHash(file.fileName), await Git.getCurrentBranch(file.fileName), await Git.getRepoUrl(file.fileName)));
                if (!localPaths.has(metaData.repo)) {
                    localPaths.set(metaData.repo, await Git.findGitDirectory(file.fileName));

                    const gitEnvChangedCB = async _ => {
                        //will be executed when the current branch or head commit changes
                        branches.set(file.fileName, getSpecifier(await Git.getCurrentCommitHash(file.fileName), await Git.getCurrentBranch(file.fileName), await Git.getRepoUrl(file.fileName)));
                    };
                    watchFile(localPaths.get(metaData.repo) + '/.git/HEAD', gitEnvChangedCB);
                    watchFile(localPaths.get(metaData.repo) + '/.git/' + metaData.branch, gitEnvChangedCB);
                }
                metaData.users.set(net.siteId, await Git.getUserName(file.fileName));
                if (usersChanged) {
                    usersChanged();
                }

                //pretend the initial doc came from the same source
                const document = new Document({ siteId: 1, text: (await Git.getCurrentFileVersion(file.fileName)) }).replicate(net.siteId);

                //check for local modifications already present
                //this solution is just a placeholder
                // const docText = file.getText();
                // document.setTextInRange(0,document.getText().length,docText);
                setLocalDocument({
                    document,
                    metaData
                }, file.fileName, commit, branch, repo);
                console.log('registered ' + metaData.file);
            } catch (e) {
                //some files opened might not be in a git repo...
                console.warn(e);
            }
        }
    }

    function getAllChanges() {
        const changes = [];
        for (let [key, data] of documents) {
            changes.push({ metaData: data.metaData, operations: data.document.getOperations(), authors: Array.from(data.metaData.users) });
        }
        return changes;
    }
    let usersChanged;
    function setUserUpdatedCallback(cb: Function) {
        usersChanged = cb;
    }

    

    function getUsers(): User[] {
        const users: User[] = [];
        for (let [key, doc] of documents) {
            for (let [siteId, name] of doc.metaData.users) {
                if (users.filter(u => u.siteId == siteId).length == 0) {
                    if (stagedSiteIds.indexOf(siteId) > -1) {
                        users.push(new User(name + ' (staged)', siteId));
                    } else {
                        users.push(new User(name, siteId));
                    }
                }
            }
        }
        return users;
    }

    let staging = Promise.resolve();
    const stagedSiteIds: Number[] = [];
    async function toggleStageChangesBySiteId(siteId) {
        if (stagedSiteIds.indexOf(siteId) > -1) {
            stagedSiteIds.splice(stagedSiteIds.indexOf(siteId), 1);
        }
        else {
            stagedSiteIds.push(siteId);
        }
        await staging;
        staging = stageChangesBySiteIDs(stagedSiteIds);
        if (usersChanged) {
            usersChanged();
        }
    }

    async function stageChangesBySiteIDs(siteIDs: Number[]) {
        for (let [_, document] of documents) {
            const filepath = `${vscode.workspace.rootPath}${document.metaData.file}`;
            if (branches.get(filepath) == getSpecifier(document.metaData.commit, document.metaData.branch, document.metaData.repo)) {
                const newDoc = document.document.replicate(net.siteId);
                const operationsToExclude = newDoc.getOperations().filter(o => o.spliceId && siteIDs.indexOf(o.spliceId.site) == -1 && o.spliceId.site != 1);
                newDoc.undoOrRedoOperations(operationsToExclude);
                await Git.stageGitObject(filepath, newDoc.getText());
                newDoc.undoOrRedoOperations(operationsToExclude);
            }
        }
    }

    

    function timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function switchBranch() {
        const branch = await vscode.window.showQuickPick(Git.getBranches(vscode.workspace.rootPath + '/a'));// the /a is a hack to get git to not effectively cd..
        if (!branch) {
            return;
        }
        if (changesPaused) {
            cancelPausedChanges(new Error('branch switched'));
            pendingRemoteChanges = Promise.resolve();
            changesPaused = false;
        }
        //redo all invisible changes so undo all doesn't glitch
        if (!remoteChangesVisible) {
            await toggleRemoteChangesVisible();
        }
        //basically undo all because vs code sometimes detects switching branches as local edits despite the files not being opened...
        await toggleRemoteChangesVisible(true);
        //remote changes are gonna be visible after branch switch
        remoteChangesVisible = true;

        await vscode.workspace.saveAll(true);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await Git.resetAndSwitchBranch(vscode.workspace.rootPath + '/a', branch);
        stagedSiteIds.splice(0);
        if (usersChanged) {
            usersChanged();
        }
        const edits = [];
        for (let [key, doc] of documents) {
            const filepath = `${localPaths.has(doc.metaData.repo) ? localPaths.get(doc.metaData.repo) : vscode.workspace.rootPath}${doc.metaData.file}`;
            if (await Git.getCurrentBranch(filepath) == doc.metaData.branch && await Git.getCurrentCommitHash(filepath) == doc.metaData.commit && await Git.getRepoUrl(filepath) == doc.metaData.repo) {
                branches.set(filepath, getSpecifier(await Git.getCurrentCommitHash(filepath), await Git.getCurrentBranch(filepath), await Git.getRepoUrl(filepath)));
                const localdoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`file://${filepath}`));
                const localText = localdoc.getText();
                if (doc.document.getText() != localText) {
                    const edit = new vscode.WorkspaceEdit();
                    const endPosition = localdoc.positionAt(localText.length);
                    edit.replace(vscode.Uri.file(filepath), new vscode.Range(new vscode.Position(0, 0), endPosition), doc.document.getText());
                    currentChanges.push({ start: { line: 0, character: 0 }, end: { line: endPosition.line, character: endPosition.character }, text: doc.document.getText() });
                    edits.push(vscode.workspace.applyEdit(edit));
                }
            }
        }
        await Promise.all(edits);
    }

    let remoteChangesVisible = true;
    async function toggleRemoteChangesVisible(includeOwnChanges?: boolean) {
        if (changesPaused) {
            vscode.window.showErrorMessage('cannot do that while changes are paused');
            return;
        }
        remoteChangesVisible = !remoteChangesVisible;
        const users = getUsers();
        const siteIdsToUndo = users.map(u => u.siteId).filter(i => i != 1 && (i != net.siteId || includeOwnChanges));

        //undo or redo operations from remote instances, 
        for (let [_, document] of documents) {
            const filepath = `${localPaths.has(document.metaData.repo) ? localPaths.get(document.metaData.repo) : vscode.workspace.rootPath}${document.metaData.file}`;
            if (await Git.getCurrentBranch(filepath) == document.metaData.branch && await Git.getCurrentCommitHash(filepath) == document.metaData.commit && await Git.getRepoUrl(filepath) == document.metaData.repo) {
                const filepath = `${localPaths.has(document.metaData.repo) ? localPaths.get(document.metaData.repo) : vscode.workspace.rootPath}${document.metaData.file}`;
                const newDoc = document.document.replicate(net.siteId);
                const operationsToExclude = newDoc.getOperations().filter(o => o.spliceId && siteIdsToUndo.indexOf(o.spliceId.site) != -1);
                const textOperations = newDoc.undoOrRedoOperations(operationsToExclude);
                if (remoteChangesVisible) {
                    textOperations.textUpdates = invertTextUpdates(textOperations.textUpdates);
                }
                applyEditToLocalDoc(filepath, textOperations);
            }
        }
    }

    //copied out of @atom/teletype-crdt document because not public
    function invertTextUpdates(textUpdates) {
        const invertedTextUpdates = []
        for (let i = 0; i < textUpdates.length; i++) {
            const { oldStart, oldEnd, oldText, newStart, newEnd, newText } = textUpdates[i]
            invertedTextUpdates.push({
                oldStart: newStart,
                oldEnd: newEnd,
                oldText: newText,
                newStart: oldStart,
                newEnd: oldEnd,
                newText: oldText
            })
        }
        return invertedTextUpdates
    }

    let changesPaused = false;
    let applyPausedChanges, cancelPausedChanges;
    function togglePauseChanges() {
        changesPaused = !changesPaused;
        if (changesPaused) {
            pendingRemoteChanges = new Promise((resolve, reject) => {
                applyPausedChanges = resolve;
                cancelPausedChanges = reject;
            });
        }
        if (!changesPaused) {
            applyPausedChanges();
            pendingRemoteChanges = Promise.resolve();
        }
    }

    let saveCB;
    function setSaveCallback(cb){
        saveCB = cb;
    }

    let saveTimeout;
    function save(){
        if(saveCB){
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveCB, 1000);
        }
    }

    return {onLocalChange, onRemteChange, cursorPositionChanged, registerFile, getAllChanges, setUserUpdatedCallback, getUsers, toggleStageChangesBySiteId, stageChangesBySiteIDs, switchBranch, toggleRemoteChangesVisible, togglePauseChanges, setSaveCallback, siteId: net.siteId};
}
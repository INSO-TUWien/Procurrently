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

export default async (siteId?: number, history?) => {
    let net;

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
        if (documents.has(`${filename}${specifier}`)) {
            console.warn('document already exists, document not updated!');
            return;
        }
        documents.set(`${filename}${specifier}`, document);
    }


    //remote changes that have not fired a localchangeevent yet
    const currentChanges = [];

    async function onLocalChange(e: vscode.TextDocumentChangeEvent) {
        if (!getLocalDocument(e.document.fileName)) {
            if (await Git.isIgnored(e.document.fileName)) {
                return;
            }
            await registerFile(e.document.fileName);
        } else {
            const doc = getLocalDocument(e.document.fileName);
            const operations = [];
            for (let change of e.contentChanges) {
                const objects = ['start', 'end'];
                const props = ['line', 'character'];

                //check if this change has just been added by remote
                const knownChanges = currentChanges.filter(c => objects.map(o => props.map(p => c[o][p] == change.range[o][p])) && c.text == change.text && c.filepath == e.document.fileName);
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
        const filepath = `${localPaths.has(metaData.repo) ? localPaths.get(metaData.repo) : vscode.workspace.rootPath + '/'}${metaData.file}`;
        //todo check meta file and branch
        if (!getLocalDocument(filepath, metaData.commit, metaData.branch, metaData.repo)) {
            await registerFile(filepath, metaData.branch, metaData.commit, metaData.repo);
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
            currentChanges.push({ start: { line: o.oldStart.row, character: o.oldStart.column }, end: { line: o.oldEnd.row, character: o.oldEnd.column }, text: o.newText, filepath });
            await vscode.workspace.applyEdit(edit);
        }
    }

    async function cursorPositionChanged(e: vscode.TextEditorSelectionChangeEvent) {
        if (e.selections.length == 1) {
            registerFile(e.textEditor.document.fileName);
            const metaData = { cursorPosition: { line: e.selections[0].active.line, character: e.selections[0].active.character }, ...getLocalDocument(e.textEditor.document.fileName).metaData };
            net.sendUpdate({ operations: [], metaData });
        }
    }



    async function registerFile(file: string, branch?: string, commit?: string, repo?: string) {
        if (!branch) {
            branch = await Git.getCurrentBranch(file);
        }
        if (!commit) {
            commit = await Git.getCurrentCommitHash(file);
        }
        if (!repo) {
            repo = await Git.getRepoUrl(file);
        }

        if (!getLocalDocument(file, commit, branch, repo)) {
            try {
                const metaData = Object.freeze({
                    branch,
                    commit,
                    repo,
                    file: (await Git.getFilePathRelativeToRepo(file)),
                    users: new Map()
                });
                branches.set(file, getSpecifier(await Git.getCurrentCommitHash(file), await Git.getCurrentBranch(file), await Git.getRepoUrl(file)));
                if (!localPaths.has(metaData.repo)) {
                    localPaths.set(metaData.repo, await Git.findGitDirectory(file));
                    Git.onHeadChanged(file, onBranchChanged);
                }
                metaData.users.set(net && net.siteId || siteId, await Git.getUserName(file));
                if (usersChanged) {
                    usersChanged();
                }

                //pretend the initial doc came from the same source
                const document = new Document({ siteId: 1, text: (await Git.getCurrentFileVersion(file, commit)) }).replicate(net && net.siteId || siteId);

                //check for local modifications already present
                //this solution is just a placeholder
                // const docText = file.getText();
                // document.setTextInRange(0,document.getText().length,docText);
                setLocalDocument({
                    document,
                    metaData
                }, file, commit, branch, repo);
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
            const filepath = `${vscode.workspace.rootPath + '/'}${document.metaData.file}`;
            if (branches.get(filepath) == getSpecifier(document.metaData.commit, document.metaData.branch, document.metaData.repo)) {
                const newDoc = document.document.replicate(net.siteId);
                const operationsToExclude = newDoc.getOperations().filter(o => o.spliceId && siteIDs.indexOf(o.spliceId.site) == -1 && o.spliceId.site != 1);
                newDoc.undoOrRedoOperations(operationsToExclude);
                await Git.stageGitObject(filepath, newDoc.getText());
                newDoc.undoOrRedoOperations(operationsToExclude);
            }
        }
    }

    async function commitChanges() {
        const message = await vscode.window.showInputBox({ prompt: 'commit message' });
        if (message) {
            commitChangesBySiteIDs(message, stagedSiteIds);
        }
    }

    async function commitChangesBySiteIDs(message, siteIDs) {
        const ourSiteIDs = JSON.parse(JSON.stringify(siteIDs));
        if (siteIDs.length == 0) {
            vscode.window.showErrorMessage('please stage authors for commit first!');
            return;
        }
        //stage all the changes by author...
        const keysToDelete = [];
        const reposToCommit = new Set<string>();
        for (let [key, document] of documents) {
            const filepath = `${vscode.workspace.rootPath + '/'}${document.metaData.file}`;
            if (branches.get(filepath) == getSpecifier(document.metaData.commit, document.metaData.branch, document.metaData.repo)) {
                const newDoc = document.document.replicate(net.siteId);
                const operationsToExclude = newDoc.getOperations().filter(o => o.spliceId && ourSiteIDs.indexOf(o.spliceId.site) == -1 && o.spliceId.site != 1);
                newDoc.undoOrRedoOperations(operationsToExclude);
                await Git.stageGitObject(filepath, newDoc.getText());
                keysToDelete.push(key);
                reposToCommit.add(await Git.findGitDirectory(filepath));
            }
        }

        //commit
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        const newCommitHashes = new Map<string, string>();
        for (let project of reposToCommit) {
            newCommitHashes.set(project, await Git.commit(message, project + '/a'));
            await Git.reset(project + '/a');
        }
        await onBranchChanged();

        //replay non committed changes onto new commit
        for (let key of keysToDelete) {
            const document = documents.get(key);
            const filepath = `${vscode.workspace.rootPath + '/'}${document.metaData.file}`;
            await registerFile(filepath);
            const postCommitDoc = getLocalDocument(filepath);
            if (postCommitDoc.metaData.commit == document.metaData.commit) {
                console.error('post commit is same as pre commit!');
                return;
            }
            const newDoc = document.document.replicate(net.siteId);
            const operationsToExclude = newDoc.getOperations().filter(o => o.spliceId && ourSiteIDs.indexOf(o.spliceId.site) == -1 && o.spliceId.site != 1);

            //update operations of new doc
            for (let site of new Set(operationsToExclude.map(o => o.spliceId.site))) {
                const textUpdates = invertTextUpdates(newDoc.undoOrRedoOperations(operationsToExclude.filter(o => o.spliceId.site == site)).textUpdates);
                await applyEditToLocalDoc(filepath, { textUpdates });
                for (let update of textUpdates) {
                    postCommitDoc.document.setTextInRange(update.oldStart, update.oldEnd, update.newText)[0].spliceId.site = site;
                }
            }
            //update authors of new doc
            for (let [k, v] of document.metaData.users) {
                postCommitDoc.metaData.users.set(k, v);
            }
        }

        //these changes are on the old commit and are no longer needed
        for (let key of keysToDelete) {
            documents.delete(key);
        }
    }



    function timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function onBranchChanged() {
        stagedSiteIds.splice(0);
        if (usersChanged) {
            usersChanged();
        }
        const edits = [];
        const keysToRemove = [];
        for (let [key, doc] of documents) {
            const filepath = `${localPaths.has(doc.metaData.repo) ? localPaths.get(doc.metaData.repo) : vscode.workspace.rootPath + '/'}${doc.metaData.file}`;
            branches.set(filepath, getSpecifier(await Git.getCurrentCommitHash(filepath), await Git.getCurrentBranch(filepath), await Git.getRepoUrl(filepath)));
            if (await Git.getCurrentBranch(filepath) == doc.metaData.branch && await Git.getRepoUrl(filepath) == doc.metaData.repo) {
                if (await Git.getCurrentCommitHash(filepath) == doc.metaData.commit) {
                    const localdoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`file://${filepath}`));
                    const localText = localdoc.getText();
                    if (doc.document.getText() != localText) {
                        const edit = new vscode.WorkspaceEdit();
                        const endPosition = localdoc.positionAt(localText.length);
                        edit.replace(vscode.Uri.file(filepath), new vscode.Range(new vscode.Position(0, 0), endPosition), doc.document.getText());
                        currentChanges.push({ start: { line: 0, character: 0 }, end: { line: endPosition.line, character: endPosition.character }, text: doc.document.getText() });
                        edits.push(vscode.workspace.applyEdit(edit));
                    }
                } else {
                    try {
                        //either we are ahead or behind this change
                        if (!(await Git.getBranchCommitsSinceCommit(filepath, doc.metaData.branch, doc.metaData.commit)).includes(await Git.getCurrentCommitHash(filepath, doc.metaData.branch))) {
                            //this commit is older than the currently checked out one
                            keysToRemove.push(key);
                        }
                    } catch (e) {
                        console.error('failed to remove outdated file ' + JSON.stringify(doc));
                        console.error(e);
                    }
                }
            }
        }
        for (let key of keysToRemove) {
            //documents.delete(key);
        }
        await Promise.all(edits);
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
        await onBranchChanged();
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
            const filepath = `${localPaths.has(document.metaData.repo) ? localPaths.get(document.metaData.repo) : vscode.workspace.rootPath + '/'}${document.metaData.file}`;
            if (await Git.getCurrentBranch(filepath) == document.metaData.branch && await Git.getCurrentCommitHash(filepath) == document.metaData.commit && await Git.getRepoUrl(filepath) == document.metaData.repo) {
                const filepath = `${localPaths.has(document.metaData.repo) ? localPaths.get(document.metaData.repo) : vscode.workspace.rootPath + '/'}${document.metaData.file}`;
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
    function setSaveCallback(cb) {
        saveCB = cb;
    }

    let saveTimeout;
    function save() {
        if (saveCB) {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveCB, 1000);
        }
    }

    await vscode.workspace.saveAll(true);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await Git.reset(vscode.workspace.rootPath + '/a');
    if (history) {
        for (let change of history) {
            await onRemteChange(change);
        }
    }

    //setup peer to peer connection
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('procurrently.bootstrapIP')) {
            if (net) {
                net.close();
            }
            net = new Network(siteId, vscode.workspace.getConfiguration('procurrently').get('bootstrapIP'));
            net.onRemoteEdit(onRemteChange);
            net.setDataProviderCallback(getAllChanges);
        }
    })
    net = new Network(siteId, vscode.workspace.getConfiguration('procurrently').get('bootstrapIP'));
    net.onRemoteEdit(onRemteChange);
    net.setDataProviderCallback(getAllChanges);

    return { onLocalChange, onRemteChange, cursorPositionChanged, registerFile, getAllChanges, setUserUpdatedCallback, getUsers, toggleStageChangesBySiteId, stageChangesBySiteIDs, switchBranch, toggleRemoteChangesVisible, togglePauseChanges, setSaveCallback, siteId: net.siteId, commitChanges };
}
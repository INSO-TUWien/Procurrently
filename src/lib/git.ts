import * as fs from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import { spawn } from 'child_process';
import * as chokidar from 'chokidar';

const readFile = promisify(fs.readFile);
const readDir = promisify(fs.readdir);

/**
 * Promies wrapper around the spawn interface
 * @param process process to start
 * @param args arguments
 * @param options options
 */
function promiseSpawn(process, args, options = {}): Promise<string> {
    return new Promise(async (resolve, reject) => {
        try {
            const proc = spawn(process, args, options);
            let output = '';
            proc.stdout.on('data', data => {
                output += data.toString();
            });
            proc.stdout.on('end', () => {
                resolve(output);
            });
            proc.stderr.on('data', d => console.error(d.toString()));
            proc.on('exit', code => code != 0 ? reject('unexpected error') : null);
        } catch (e) {
            reject(e);
        }
    });
}

const repositories: Map<string, string> = new Map();

/**
 * This is essentially cd .. for path strings
 * @param path A unix style path
 * @returns the path to the parent directory
 */
function dirUp(path: string) {
    const parts = path.split(/\//g);
    for (let i = parts.length - 1; i > 0; i--) {
        if (parts[i] == '') {
            continue;
        }
        return parts.slice(0, i).join('/');
    }
    return '';
}

/**
 * finds the parent folder of the .git directory
 * @param startpath path to start the search
 */
export async function findGitDirectory(startpath: string): Promise<string> {
    let currpath = path.dirname(startpath).toString();
    if (repositories.has(startpath)) {
        return repositories.get(startpath);
    }
    let found = false;
    while (currpath.length > 0) {
        try {
            const dir = await readDir(currpath);
            if (dir.indexOf('.git') > -1) {
                repositories.set(startpath, currpath);
                return currpath;
            }
        } catch (e) {
            //directory not on disk
        }
        currpath = dirUp(currpath);
    }
    throw new Error('Not a git directory');
}

/**
 * returns the current Branch of the repository
 * @param path the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
export async function getCurrentBranch(path) {
    const gitDir: String = await findGitDirectory(path);
    return (await readFile(gitDir + '/.git/HEAD')).toString().match(/ref: (.*)/)[1];
}

/**
 * returns the origin remote url
 * @param path the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
export async function getRepoUrl(path: string) {
    const gitDir: String = await findGitDirectory(path);
    return promiseSpawn('git', ['config', '--get', 'remote.origin.url'], { cwd: gitDir });
}

/**
 * reads a git file (equivalent to git cat-file -p)
 * @param hash the git hash of the object
 * @param repositoryPath the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
function readGitObject(hash: string, repositoryPath: string): Promise<string> {
    return promiseSpawn('git', ['cat-file', '-p', hash], { cwd: repositoryPath })
}

/**
 * returns the relative path to a file in regards to a git repo
 * @param filename the full path to a file including the filename
 */
export async function getFilePathRelativeToRepo(filename: string): Promise<string> {
    const dir: string = await findGitDirectory(filename);
    return filename.substr(dir.length);
}

enum gitObjectType {
    tree,
    blob,
    content
}

/**
 * Parses git cat-file contents into tree and blob objects
 * @param content git cli response
 */
function parseGitObject(content: string) {
    const lines = content.split(/\n/g);

    //if this is a commit
    let typeIndex = 1;

    const parsedContent = [];

    if (content.startsWith('tree')) {
        typeIndex = 0;
    }
    for (let l of lines) {
        const line = l.split(/\s/g);
        switch (line[typeIndex]) {
            case 'tree':
                parsedContent.push({ type: gitObjectType.tree, hash: line[typeIndex + 1], name: line[typeIndex + 2] || '' });
                break;
            case 'blob':
                parsedContent.push({ type: gitObjectType.blob, hash: line[typeIndex + 1], name: line[typeIndex + 2] || '' });
                break;
            default:
                if (parsedContent.length == 0) {
                    return [{ type: gitObjectType.content, content }];
                }
        }
    }
    return parsedContent;
}

export async function getBranchCommitsSinceCommit(repo: string, branch: string, commit: string) {
    const gitDir = await findGitDirectory(repo);
    const rawCommits = await promiseSpawn('git', ['rev-list', '-b', branch, '--pretty=format:"%H"', '--no-patch', commit + '..HEAD'], { cwd: gitDir });
    return rawCommits.split(/\n/g);
}

/**
 * returns the hash of the current HEAD commit
 * @param repo the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
export async function getCurrentCommitHash(repo: string, branch?: string) {
    const gitDir = await findGitDirectory(repo);
    let commit = branch || await getCurrentBranch(repo);
    let currentObject = parseGitObject(await readGitObject(commit, gitDir));
    return currentObject.filter(o => o.type == gitObjectType.tree)[0].hash;
}

/**
 * returns the current version committed in git of a specified file
 * @param filename the full path to the file including the filename
 */
export async function getCurrentFileVersion(filename: string, commit?: string): Promise<string> {
    const gitDir = await findGitDirectory(filename);
    const relativeFilePath: string = await getFilePathRelativeToRepo(filename);
    let currentObject = parseGitObject(await readGitObject(commit || await getCurrentCommitHash(filename), gitDir));
    //get the tree of the git root
    for (let dir of relativeFilePath.split(/\//g)) {
        if (dir == '') {
            continue;
        }
        const ref = currentObject.filter(o => o.name == dir)[0];
        if (!ref) {
            throw new Error(filename + ' not found in repo');
        }
        if (ref.type == gitObjectType.tree) {
            currentObject = parseGitObject(await readGitObject(ref.hash, gitDir));
        }
        else if (ref.type == gitObjectType.blob) {
            return await readGitObject(ref.hash, gitDir);
        }
        else {
            return currentObject[0].content;
        }
    }
}

/**
 * computes the git hash of content
 * this is intended for checking if a file has been modified
 * @param content content to hash
 */
export async function getGitHash(content: string) {
    return new Promise(async (resolve, reject) => {
        const proc = spawn('git', ['hash-object', '--stdin']);
        let output = '';
        proc.stdout.on('data', data => {
            output += data.toString();
        });
        proc.stderr.on('data', d => console.error(d.toString()));
        proc.on('exit', code => code != 0 ? reject('unexpected error') : resolve(output));

        proc.stdin.write(content);
        proc.stdin.end();
    });
}

/**
 * Adds content as a git object (equivalent to git hash object -w)
 * @param content content to put into a git object
 * @param repo path to the git repository or a subfolder of the repository (will automatically find the .git folder)
 */
async function addGitObject(content: string, repo): Promise<string> {
    return new Promise(async (resolve, reject) => {
        const proc = spawn('git', ['hash-object', '--stdin', '-w'], { cwd: repo });
        let output = '';
        proc.stdout.on('data', data => {
            output += data.toString();
        });
        proc.stderr.on('data', d => console.error(d.toString()));
        proc.on('exit', code => code != 0 ? reject('unexpected error') : resolve(output));

        proc.stdin.write(content);
        proc.stdin.end();
    });
}

/**
 * stage file content
 * @param filename the full file path and name
 * @param content the content to stage into this file
 */
export async function stageGitObject(filename: string, content: string) {
    const path = (await getFilePathRelativeToRepo(filename)).substr(1);
    const repositoryPath = await findGitDirectory(filename);
    const hash = await addGitObject(content, repositoryPath);
    await promiseSpawn('git', ['update-index', '--add', '--cacheinfo', '100644', hash, path], { cwd: repositoryPath });
}

/**
 * returns the configured git user for a given repository
 * @param path the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
export async function getUserName(repo: string): Promise<string> {
    const gitDir: String = await findGitDirectory(repo);
    return (await promiseSpawn('git', ['config', 'user.name'], { cwd: gitDir })).split(/\n/)[0];
}

/**
 * returns the list of local branches of this git repository
 * @param repo the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
export async function getBranches(repo: string) {
    const gitDir: String = await findGitDirectory(repo);
    return (await promiseSpawn('git', ['branch', '-a'], { cwd: gitDir }))
        .split(/\n/)
        .map(s => s.trim())
        .filter(e => !/^\s*remotes\//.test(e))
        .filter(e => !/^\*/.test(e));
}

/**
 * undoes all current changes (equivalent of git reset --hard HEAD)
 * @param repo the path to the repository or a subfolder of the repository (will automatically find .git folder)
 */
export async function reset(repo: string) {
    const gitDir: String = await findGitDirectory(repo);
    await promiseSpawn('git', ['reset', '--hard', 'HEAD'], { cwd: gitDir });
}

/**
 * switches to a different branch regardless of current changes (equivalent of git reset --hard HEAD && git checkout <branch>)
 * @param repo the path to the repository or a subfolder of the repository (will automatically find .git folder)
 * @param branch the branch to switch to
 */
export async function resetAndSwitchBranch(repo: string, branch: string) {
    const gitDir: String = await findGitDirectory(repo);
    await promiseSpawn('git', ['reset', '--hard', 'HEAD'], { cwd: gitDir });
    await promiseSpawn('git', ['checkout', branch], { cwd: gitDir });
}

/**
 * Checks if a file is ignored by .gitignore
 * @param filename the file to be checked
 */
export async function isIgnored(filename: string) {
    const gitDir: String = await findGitDirectory(filename);
    const resp = await promiseSpawn('git', ['check-ignore', filename], { cwd: gitDir });
    return resp.indexOf(filename) > -1;
}

const headChangedCallbacks = new Map<string, Function>();
export async function onHeadChanged(repo: string, cb: Function) {
    const gitDir: string = await findGitDirectory(repo);
    if (headChangedCallbacks.has(gitDir)) {
        console.warn('handler for repo already defined');
        return;
    }
    chokidar.watch(gitDir + '/.git/').on('all', async (name, path) => {
        if ((/HEAD$/.test(path) || /refs\/heads/.test(path)) && name == 'change') {
            const dir = await findGitDirectory(path);
            headChangedCallbacks.get(dir)(dir);
        }
    })
    headChangedCallbacks.set(gitDir, cb);
}
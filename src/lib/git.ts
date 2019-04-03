import * as fs from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import { spawn } from 'child_process';

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
        const proc = spawn(process, args, options);
        let output = '';
        proc.stdout.on('data', data => {
            output += data.toString();
        });
        proc.stderr.on('data', d => console.error(d.toString()));
        proc.on('exit', code => code != 0 ? reject('unexpected error') : resolve(output));
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

export async function findGitDirectory(startpath: string): Promise<string> {
    let currpath = path.dirname(startpath).toString();
    if (repositories.has(startpath)) {
        return repositories.get(startpath);
    }
    let found = false;
    while (currpath.length > 0) {
        const dir = await readDir(currpath);
        if (dir.indexOf('.git') > -1) {
            repositories.set(startpath, currpath);
            return currpath;
        }
        currpath = dirUp(currpath);
    }
    throw new Error('Not a git directory');
}

export async function getCurrentBranch(path) {
    const gitDir: String = await findGitDirectory(path);
    return (await readFile(gitDir + '/.git/HEAD')).toString().match(/ref: (.*)/)[1];
}

function readGitObject(hash: string, repositoryPath: string): Promise<string> {
    return promiseSpawn('git', ['cat-file', '-p', hash], { cwd: repositoryPath })
}

async function getFilePathRelativeToRepo(filename: string): Promise<string> {
    const dir: string = await findGitDirectory(filename);
    return filename.substr(dir.length);
}

enum gitObjectType {
    tree,
    blob,
    content
}

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

export async function getCurrentFileVersion(filename: string): Promise<string> {
    const gitDir = await findGitDirectory(filename);
    let commit = await getCurrentBranch(filename);
    const relativeFilePath: string = await getFilePathRelativeToRepo(filename);
    let currentObject = parseGitObject(await readGitObject(commit, gitDir));
    //get the tree of the git root
    currentObject = parseGitObject(await readGitObject(currentObject.filter(o => o.type == gitObjectType.tree)[0].hash, gitDir));
    for (let dir of relativeFilePath.split(/\//g)) {
        if (dir == '') {
            continue;
        }
        const ref = currentObject.filter(o => o.name == dir)[0];
        if (!ref) {
            throw new Error('file not found in repo');
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

export async function stageGitObject(filename: string, content: string) {
    const path = (await getFilePathRelativeToRepo(filename)).substr(1);
    const repositoryPath = await findGitDirectory(filename);
    const hash = await addGitObject(content, repositoryPath);
    await promiseSpawn('git', ['update-index', '--add', '--cacheinfo', '100644', hash, path], { cwd: repositoryPath });
    //git update-index --add --cacheinfo 100644 93821e8182534e2d95df1acc85fa589556dd61dc contributors.txt 
}


import * as fs from 'fs';
import {promisify} from 'util';
import * as path from 'path';
import { spawn } from 'child_process';

const readFile = promisify(fs.readFile);
const readDir = promisify(fs.readdir);

const repositories:Map<string, string> = new Map();

/**
 * This is essentially cd .. for path strings
 * @param path A unix style path
 * @returns the path to the parent directory
 */
function dirUp(path:string){
    const parts = path.split(/\//g);
    for(let i = parts.length-1;i>0;i--){
        if(parts[i]==''){
            continue;
        }
        return parts.slice(0,i).join('/');
    }
}

export async function findGitDirectory(startpath:string):Promise<string>{
    let currpath = path.dirname(startpath).toString();
    if(repositories.has(startpath)){
        return repositories.get(startpath);
    }
    let found = false;
    while(currpath.length>0){
        const dir = await readDir(currpath);
        if(dir.indexOf('.git')>-1){
            repositories.set(startpath,currpath+'/.git/');
            return currpath+'/.git/';
        }
        currpath=dirUp(currpath);
    }
    throw new Error('Not a git directory');
}


export async function getCurrentBranch(path){
    const gitDir:String = await findGitDirectory(path);
    return (await readFile(gitDir+'HEAD')).toString().match(/ref: (.*)/)[1];
}

function readGitObject(hash:string, repositoryPath:string):Promise<string>{
    return new Promise((resolve,reject)=>{
        const git = spawn('git', ['cat-file', '-p', hash],{cwd:repositoryPath});
        let output='';
        git.stdout.on('data',data=>{
           output+=data.toString(); 
        });
        git.stderr.on('data',d=>console.error(d.toString()));
        git.on('exit',code=>code!=0?reject('unexpected error'):resolve(output));
    });
}

async function getFilePathRelativeToRepo(filename:string):Promise<string>{
    let dir:string = await findGitDirectory(filename);
    dir = dirUp(dir);
    return filename.substr(dir.length);
}

enum gitObjectType{
    tree,
    blob,
    content
}

function parseGitObject(content:string){
    const lines = content.split(/\n/g);
    
    //if this is a commit
    let typeIndex = 1;

    const parsedContent = [];

    if(content.startsWith('tree')){
        typeIndex=0;
    }
    for(let l of lines){
        const line = l.split(/\s/g);
        switch(line[typeIndex]){
            case 'tree':
                parsedContent.push({type:gitObjectType.tree, hash:line[typeIndex+1], name:line[typeIndex+2]||''});
                break;
            case 'blob':
                parsedContent.push({type:gitObjectType.blob, hash:line[typeIndex+1], name:line[typeIndex+2]||''});
                break;
            default:
                if(parsedContent.length==0){
                    return [{type:gitObjectType.content,content}];
                }
        }
    }
    return parsedContent;
}

export async function getCurrentFileVersion(filename:string):Promise<string>{
    const gitDir = await findGitDirectory(filename);
    let commit = await getCurrentBranch(filename);
    const relativeFilePath:string = await getFilePathRelativeToRepo(filename);
    let currentObject = parseGitObject(await readGitObject(commit, gitDir));
    //get the tree of the git root
    currentObject = parseGitObject(await readGitObject(currentObject.filter(o=>o.type==gitObjectType.tree)[0].hash, gitDir));
    for(let dir of relativeFilePath.split(/\//g)){
        if(dir==''){
            continue;
        }
        const ref = currentObject.filter(o=>o.name==dir)[0];
        if(!ref){
            throw new Error('file not found in repo');
        }
        if(ref.type==gitObjectType.tree){
            currentObject = parseGitObject(await readGitObject(ref.hash, gitDir));
        }
        else if(ref.type==gitObjectType.blob){
            return await readGitObject(ref.hash, gitDir);
        }
        else{
            return currentObject[0].content;
        }
    }
}
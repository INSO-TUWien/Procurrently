import * as git from '../../lib/git';
import * as fs from 'fs';
import { promisify } from 'util';
import { spawn } from 'child_process';
import * as rimraf from 'rimraf';


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

const testDir = __dirname+'/test_git';
beforeAll(async () => {
    fs.mkdirSync(testDir);
    console.log(await promiseSpawn('git', ['init'],{cwd:testDir}));
    fs.writeFileSync(testDir+'/test.txt','das ist ein test');
});

afterAll(done=>{
    rimraf(testDir,done)
})


test('getHash', async () => {
    const hash = await git.getGitHash('Stefan Gussner');
    expect(hash).toMatch('93821e8182534e2d95df1acc85fa589556dd61dc');
});

test('findGitDirectory', async ()=>{
    const dir = await git.findGitDirectory(testDir+'/test.txt');
    expect(dir).toMatch(testDir);
});

test('stage object',async ()=>{
    await git.stageGitObject(testDir+'/test.txt','Stefan Gussner');
    console.log('staged');
    const staged = await promiseSpawn('git',['ls-files', '--stage'],{cwd:testDir});
    const line = staged.split('/\n/g').filter(e=>e.indexOf('test.txt')>-1)[0];
    expect(line).toMatch('93821e8182534e2d95df1acc85fa589556dd61dc');
});
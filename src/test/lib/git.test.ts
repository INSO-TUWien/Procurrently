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

const testDir = __dirname + '/test_git';
beforeAll(async () => {
    fs.mkdirSync(testDir + '/a_directory', { recursive: true });
    console.log(await promiseSpawn('git', ['init'], { cwd: testDir }));
    fs.writeFileSync(testDir + '/test.txt', 'das ist ein test');
    fs.writeFileSync(testDir + '/.gitignore', 'node_modules\n');
    await promiseSpawn('git', ['add', 'test.txt'], { cwd: testDir });
    await promiseSpawn('git', ['commit', '-m', 'first'], { cwd: testDir });
    fs.writeFileSync(testDir + '/a_directory/test.txt', 'das ist ein test in einem Unterverzeichnis');
});

afterAll(done => {
    rimraf(testDir, done)
})


test('getHash', async () => {
    const hash = await git.getGitHash('Stefan Gussner');
    expect(hash).toMatch('93821e8182534e2d95df1acc85fa589556dd61dc');
});

test('findGitDirectory', async () => {
    expect.assertions(2);
    const dir = await git.findGitDirectory(testDir + '/a_directory/test.txt');
    expect(dir).toMatch(testDir);
    expect(await git.findGitDirectory(testDir + '/a_directory/test.txt')).toMatch(testDir);
});

test('findGitDirectory_just_dir', async () => {
    const dir = await git.findGitDirectory(testDir + '/a_directory/');
    expect(dir).toMatch(testDir);
});

test('findGitDirectory not a git dir', async () => {
    await expect(git.findGitDirectory('/')).rejects.toThrow('Not a git directory');
});

test('filepath relative to repo', async () => {
    expect.assertions(1);
    await expect(await git.getFilePathRelativeToRepo(testDir + '/a_directory/test.txt')).toEqual('a_directory/test.txt');
});

test('stage object', async () => {
    await git.stageGitObject(testDir + '/test.txt', 'Stefan Gussner');
    const staged = await promiseSpawn('git', ['ls-files', '--stage'], { cwd: testDir });
    const line = staged.split('/\n/g').filter(e => e.indexOf('test.txt') > -1)[0];
    expect(line).toMatch('93821e8182534e2d95df1acc85fa589556dd61dc');
});

test('get current version', async () => {
    expect.assertions(1);
    expect(await git.getCurrentFileVersion(testDir + '/test.txt')).toMatch('das ist ein test');
});

test('get current version no file', async () => {
    expect.assertions(1);
    await expect(git.getCurrentFileVersion(testDir)).rejects.toThrow('not found');
});

test('gitignore ignores the path in gitignore', async () => {
    expect.assertions(1);
    await expect(await git.isIgnored(testDir + '/node_modules')).toEqual(true);
});


test('gitignore does not ignore the path not in gitignore', async () => {
    expect.assertions(1);
    await expect(await git.isIgnored(testDir + '/test')).toEqual(false);
});
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { dirname, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const [binary, expectedVersion, expectedStatus = 'archived'] = process.argv.slice(2);
assert(binary && expectedVersion);
assert.equal(process.platform, 'darwin');
assert(['archiving', 'archived'].includes(expectedStatus));
const temp = await realpath('/tmp');
const root = await mkdtemp(join(temp, 'cf-archive-'));
const happyHome = join(root, '.happy');
const agentHome = join(happyHome, 'agent');
const config = join(root, 'happy', 'config');
const repository = join(root, 'PdrKoçum Türkçe');
const managedRoot = join(root, 'managed');
const workspaceId = 's123archivewindowsfixture';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|LANG|LC_[A-Z]+|SHELL|USER|LOGNAME)$/u.test(key)));
Object.assign(env, {
    HOME: root, TMPDIR: root, HAPPY_HOME_DIR: happyHome,
    HAPPY_AGENT_WORKSPACES_DIRECTORY: managedRoot,
    XDG_CONFIG_HOME: config,
    HAPPY_OBSERVATION_LOGS: 'true', HAPPY_OBSERVATION_LOG_LEVEL: 'error',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
});
const exec = promisify(execFile);
const git = async (...args) => (await exec('git', args, { cwd: repository, env, timeout: 20000 })).stdout;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = async path => {
    const { dev, ino, size, mtimeNs } = await lstat(path, { bigint: true });
    return [dev, ino, size, mtimeNs];
};
const socketPath = join(agentHome, 'server.sock');
let daemon, token, logs = '', phase = 'preparing fixture';

function call(method, path, body, ifMatch) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers = { authorization: `Bearer ${token}` };
        if (payload !== undefined) Object.assign(headers, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
        if (ifMatch !== undefined) headers['if-match'] = ifMatch;
        const request = httpRequest({ socketPath, path, method, headers, timeout: 10000 }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`${method} ${path}: ${response.statusCode} ${text}`));
                    return;
                }
                try { resolve(text ? JSON.parse(text) : {}); }
                catch (error) { reject(error); }
            });
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error(`Timed out at ${path}`)));
        request.on('error', reject);
        request.end(payload);
    });
}

async function wait(probe, ms = 40000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        assert.equal(daemon.exitCode, null, 'Isolated engine exited');
        try {
            const result = await probe();
            if (result) return result;
        } catch (error) {
            if (!['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) throw error;
        }
        await sleep(150);
    }
    throw new Error(`Isolated engine verification timed out while ${phase}`);
}

try {
    for (const folder of [config, repository, managedRoot]) await mkdir(folder, { recursive: true });
    await writeFile(join(config, 'happy.toml'), '[settings]\nhappy_integration = false\nmenu_bar = false\n');
    await git('init', '--initial-branch=main');
    await git('config', 'user.email', 'archive-fixture@example.invalid');
    await git('config', 'user.name', 'Owned archive fixture');
    await writeFile(join(repository, 'README.md'), 'source repository\n');
    await git('add', 'README.md');
    await git('commit', '-m', 'Fixture source');

    phase = 'starting engine';
    daemon = spawn(binary, ['run'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
    for (const stream of [daemon.stdout, daemon.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-4000); });
    token = (await wait(() => readFile(join(agentHome, 'token'), 'utf8'))).trim();
    const health = await wait(async () => {
        const value = await call('GET', '/v0/health');
        return value.ready && value;
    });
    assert.equal(health.version.daemon, expectedVersion);

    phase = 'registering project';
    const { project } = await call('POST', '/v0/projects', { path: repository });
    await wait(async () => {
        const { project: current } = await call('GET', `/v0/projects/${project.id}`);
        assert.notEqual(current.initialization.status, 'failed', JSON.stringify(current.initialization));
        phase = `registering project (${current.status}, ${current.initialization.status}, ${current.worktreeSupport})`;
        return current.status === 'active' && current.initialization.status === 'ready';
    });
    phase = 'creating the isolated fixture with real Git';
    const fixtureDb = join(agentHome, 'agent.sqlite');
    assert((await realpath(fixtureDb)).startsWith(root + sep));
    const db = new DatabaseSync(fixtureDb);
    let directory;
    try {
        const projectRecord = db.prepare('select storage_key, repository_ref from happy_agent_module_projects where id = ?').get(project.id);
        assert.equal(await realpath(projectRecord.repository_ref), await realpath(repository));
        assert.match(projectRecord.storage_key, /^[a-z0-9-]+$/);
        const managed = join(managedRoot, projectRecord.storage_key);
        await mkdir(managed, { recursive: true });
        const storage = 'archive-fixture';
        const branch = `worktree/${storage}`;
        await git('worktree', 'add', '-b', branch, join(managed, storage), 'main');
        directory = await realpath(join(managed, storage));
        const common = await realpath(join(repository, '.git'));
        const head = (await git('rev-parse', 'HEAD')).trim();
        const now = Date.now();
        db.prepare(`insert into happy_agent_module_workspaces (
            id, project_ref, parent_id, name, name_key, name_configured, branch, storage_key, kind,
            path, base_ref, base_commit, git_common_dir, presence, status, order_key, version,
            git_ahead, git_behind, git_detached, git_head, initialization_attempt, created_at, updated_at
        ) values (?, ?, ?, 'Archive fixture', 'archive fixture', 1, ?, ?, 'git_worktree',
            ?, 'main', ?, ?, 'present', 'ready', '1', 2, 0, 0, 0, ?, 1, ?, ?)`)
            .run(workspaceId, project.id, project.id, branch, storage, directory, head, common, head, now, now);
    } finally {
        db.close();
    }
    const apiPath = `/v0/workspaces/${workspaceId}`;
    const { workspace: ready } = await call('GET', apiPath);
    assert.equal(ready.kind, 'worktree');
    assert.equal(ready.initialization.status, 'ready');
    assert(directory.startsWith(root + sep));
    await unlink(join(directory, '.git'));
    await git('worktree', 'prune', '--expire=now');
    const registry = await git('worktree', 'list', '--porcelain', '-z');
    assert.equal(registry.split('\0').filter(field => field.startsWith('worktree ')).length, 1);

    const nested = join(directory, 'içerik');
    await mkdir(nested);
    const file = join(nested, 'öğrenci-🚀.txt');
    const bytes = Buffer.from('çğıİöşü e\u0301 日本語 🚀\r\n');
    await writeFile(file, bytes);
    const trackedFile = join(directory, 'README.md');
    const trackedBytes = await readFile(trackedFile);
    const monitored = [directory, trackedFile, nested, file];
    const before = await Promise.all(monitored.map(identity));
    const filesBefore = await readdir(directory);
    const nestedBefore = await readdir(nested);
    const { workspace: started } = await call('POST', apiPath + '/archive', {}, ready.version);
    assert.equal(started.status, 'archiving');
    phase = 'waiting for archival';
    if (expectedStatus === 'archived') {
        await wait(async () => (await call('GET', apiPath)).workspace.status === 'archived');
    } else {
        await sleep(5000);
    }
    const { workspace: end } = await call('GET', apiPath);
    assert.equal(end.status, expectedStatus);
    assert.deepEqual(await Promise.all(monitored.map(identity)), before);
    assert.deepEqual(await readdir(directory), filesBefore);
    assert.deepEqual(await readdir(nested), nestedBefore);
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readFile(trackedFile), trackedBytes);
    assert.equal(await git('worktree', 'list', '--porcelain', '-z'), registry);
    console.log(JSON.stringify({
        version: health.version.daemon, status: end.status, platform: process.platform,
        architecture: process.arch, isolatedProfile: true,
        originalFilesPreserved: true, gitRegistryPreserved: true, utf8FileSha256: sha(bytes),
    }));
} catch (error) {
    console.error(phase);
    if (logs) console.error(logs);
    const observation = await readFile(join(agentHome, 'observation', 'agent.log'), 'utf8').catch(() => '');
    if (observation) console.error(observation.slice(-4000));
    throw error;
} finally {
    if (daemon) {
        if (token) await call('POST', '/v0/shutdown').catch(() => undefined);
        if (daemon.exitCode === null) {
            await Promise.race([new Promise(resolve => daemon.once('exit', resolve)), sleep(2500)]);
            if (daemon.exitCode === null) daemon.kill();
        }
    }
    const checked = await realpath(root);
    assert.equal(dirname(checked), temp);
    assert(checked.startsWith(join(temp, 'cf-archive-')));
    await rm(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(error => {
        console.error(`Could not clean up isolated fixture: ${error.message}`);
    });
}

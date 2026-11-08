import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep, win32 } from 'node:path';

// Same public v0 routes and socket identity as pinned HappyAgentClient/localAgentPaths.
function clientFor(socketPath, token) {
    const json = (method, path, value) => new Promise((done, fail) => {
        const body = value === undefined ? undefined : JSON.stringify(value);
        const request = httpRequest({ socketPath, path: '/' + path, method,
            headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) } }, response => {
            const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                if (response.statusCode < 200 || response.statusCode >= 300) return fail(Error(`Owned API ${method} ${path}: ${response.statusCode} ${text}`));
                try { done(text ? JSON.parse(text) : {}); } catch (error) { fail(error); }
            });
        });
        request.on('error', fail); request.end(body);
    });
    return {
        getHealth: () => json('GET', 'v0/health'),
        createBot: body => json('POST', 'v0/bots', body),
        sendMessage: (id, body) => json('POST', `v0/agents/${encodeURIComponent(id)}/send`, body),
        getMessages: id => json('GET', `v0/agents/${encodeURIComponent(id)}/messages?limit=100`),
        shutdown: () => json('POST', 'v0/shutdown'),
    };
}

const binary = resolve(process.argv[2]);
const root = await mkdtemp(join(homedir(), 'cyberfi-skill-smoke-'));
const happyHome = join(root, '.happy');
const role = join(root, '.agents', 'skills', 'owned-review');
const support = join(role, 'support.txt');
const unrelated = process.platform === 'win32' ? join(root, 'unrelated-private.txt') : join(happyHome, 'agent', 'unrelated-private.txt');
const instruction = '---\nname: owned-review\ndescription: Isolated native skill access.\n---\nOWNED_ROLE_INSTRUCTIONS';
await mkdir(role, { recursive: true });
await mkdir(join(root, 'workspace'));
await writeFile(join(role, 'SKILL.md'), instruction);
await writeFile(support, 'OWNED_SUPPORT_SENTINEL');
await mkdir(dirname(unrelated), { recursive: true });
await writeFile(unrelated, 'UNRELATED_PRIVATE_SENTINEL');
const auth = randomBytes(24).toString('hex');
const stages = new Map();
const readCommand = path => process.platform === 'win32'
    ? `Get-Content -LiteralPath '${path.replaceAll("'", "''")}' -ErrorAction Stop`
    : `cat '${path.replaceAll("'", "'\\''")}'`;
const fixture = createServer(async (request, response) => {
    try {
        assert.equal(request.headers.authorization, `Bearer ${auth}`);
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString());
        const key = input.options?.sessionId;
        const child = JSON.stringify(input.context?.messages ?? input.messages ?? []).includes('CHILD_SKILL_CHECK');
        let content = [{ type: 'text', text: 'Owned smoke complete.' }];
        if (child && !String(key).endsWith(':title')) {
            const stage = stages.get(key) ?? 0;
            const calls = [
                ['read_skill', { name: 'owned-review' }],
                ['exec_command', { cmd: readCommand(support), yield_time_ms: 30000 }],
            ];
            if (stage < calls.length) {
                stages.set(key, stage + 1);
                content = [{ type: 'tool_call', callId: `owned-${stage}`, name: calls[stage][0], arguments: calls[stage][1] }];
            } else {
                const signals = [...JSON.stringify(input.context?.messages ?? input.messages ?? []).matchAll(/Process (?:running with session ID (\d+)|exited with code -?\d+)/g)];
                const pending = signals.at(-1)?.[1];
                if (pending) content = [{ type: 'tool_call', callId: `owned-poll-${randomUUID()}`, name: 'write_stdin', arguments: { session_id: Number(pending), chars: '', yield_time_ms: 30000 } }];
            }
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ content, stopReason: content[0].type === 'tool_call' ? 'toolUse' : 'stop' }));
    } catch (error) { response.writeHead(500).end(String(error)); }
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const environment = { ...process.env };
for (const name of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(name)) delete environment[name];
const daemon = spawn(binary, ['run'], {
    cwd: join(root, 'workspace'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...environment, HOME: root, USERPROFILE: root, HAPPY_HOME_DIR: happyHome,
        HAPPY_GYM_INFERENCE_URL: `http://127.0.0.1:${fixture.address().port}/inference`, HAPPY_GYM_TOKEN: auth },
});
daemon.stdout.resume(); daemon.stderr.resume();
let client;
const pause = ms => new Promise(done => setTimeout(done, ms));
async function wait(work, milliseconds = 60000) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
        if (daemon.exitCode !== null) throw Error('Owned engine exited unexpectedly');
        try { const result = await work(); if (result !== undefined && result !== null && result !== false) return result; } catch (error) {
            if (!['ENOENT', 'ECONNREFUSED'].includes(error?.code ?? error?.cause?.code)) throw error;
        }
        await pause(100);
    }
    throw Error('Owned skill smoke timed out');
}
const toolsOf = history => history.runs.flatMap(run => run.messages).flatMap(message => message.content).filter(block => block.type === 'tool_call');
const output = tool => typeof tool.result === 'string' ? tool.result : tool.result?.output ?? JSON.stringify(tool.result);
async function request(agentId, tool) {
    const id = `s${randomUUID().replaceAll('-', '').slice(0, 23)}`;
    await client.sendMessage(agentId, { id, text: 'Isolated native skill check', delivery: 'queue',
        content: [{ type: 'tool_call_request', ...tool }],
        mode: { effort: 'off', modelId: 'openai/gym', providerId: 'gym', permissionMode: 'read_only', serviceTier: null } });
    return await wait(async () => {
        const history = await client.getMessages(agentId, { limit: 100 });
        const run = history.runs.find(run => run.messages.some(message => message.id === id));
        if (!run || !['completed', 'failed', 'stopped'].includes(run.status)) return undefined;
        const found = run.messages.flatMap(message => message.content).find(block => block.type === 'tool_call' && block.name === tool.name);
        assert(found, 'Requested tool missing'); return found;
    });
}
async function shellRead(agentId, path) {
    let tool = await request(agentId, { name: 'exec_command', arguments: { cmd: readCommand(path), yield_time_ms: 30000 } });
    let text = output(tool);
    for (let attempts = 0; attempts < 4; attempts++) {
        const running = /Process running with session ID (\d+)/.exec(output(tool));
        if (!running) return text;
        tool = await request(agentId, { name: 'write_stdin', arguments: { session_id: Number(running[1]), chars: '', yield_time_ms: 30000 } });
        text += '\n' + output(tool);
    }
    throw Error('Owned shell read did not finish');
}
try {
    const token = (await wait(() => readFile(join(happyHome, 'agent', 'token'), 'utf8'))).trim();
    const directory = join(happyHome, 'agent');
    const socket = process.platform === 'win32' ? '\\\\.\\pipe\\happy-agent-' + createHash('sha256').update(win32.resolve(directory).toLowerCase()).digest('hex') : join(directory, 'server.sock');
    client = clientFor(socket, token);
    await wait(async () => (await client.getHealth()).ready);
    const parent = (await client.createBot({ name: 'Owned native skill smoke' })).bot.agent.id;
    const read = await request(parent, { name: 'read_skill', arguments: { name: 'owned-review' } });
    assert.equal(read.status, 'completed'); assert(output(read).includes('OWNED_ROLE_INSTRUCTIONS'));
    const reference = await shellRead(parent, support);
    assert(reference.includes('OWNED_SUPPORT_SENTINEL'), 'Restricted parent support read failed: ' + reference);
    const denied = await shellRead(parent, unrelated);
    assert(!denied.includes('UNRELATED_PRIVATE_SENTINEL'), 'Unrelated private file exposed');
    const created = await request(parent, { name: 'create_agent', arguments: { title: 'Owned read-only child', model: 'openai/gym', provider: 'gym', effort: 'off', read_only: true, text: 'CHILD_SKILL_CHECK Read the owned role and support file. No other actions.' } });
    assert.equal(created.status, 'completed');
    const childId = /Created collaborator ([a-z0-9]+)/.exec(output(created))?.[1]; assert(childId, 'Missing created child ID');
    await wait(async () => {
        const calls = toolsOf(await client.getMessages(childId, { limit: 100 }));
        const skill = calls.find(tool => tool.name === 'read_skill' && tool.status !== 'running');
        const shellCalls = calls.filter(tool => ['exec_command', 'write_stdin'].includes(tool.name) && tool.status !== 'running');
        const file = shellCalls.at(-1);
        if (!skill || !file) return undefined;
        assert.equal(skill.status, 'completed'); assert(output(skill).includes('OWNED_ROLE_INSTRUCTIONS'));
        if (/Process running with session ID \d+/.test(output(file))) return undefined;
        assert(shellCalls.some(tool => output(tool).includes('OWNED_SUPPORT_SENTINEL')), 'Read-only child support read failed: ' + output(file)); return true;
    }, 120000);
    assert.equal(await readFile(support, 'utf8'), 'OWNED_SUPPORT_SENTINEL');
    assert.equal(await readFile(unrelated, 'utf8'), 'UNRELATED_PRIVATE_SENTINEL');
    console.log(JSON.stringify({ actualBinary: true, parentSkill: true, parentSupport: true, readOnlyChildSkill: true, readOnlyChildSupport: true, unrelatedPrivateDenied: true, sentinelsIntact: true, paidInference: false }));
} catch (error) {
    if (process.platform === 'win32') {
        const paths = [root, join(root, '.agents'), join(root, '.agents', 'skills'), role, support];
        const command = paths.map(path => `Write-Output '${path}'; (Get-Acl -LiteralPath '${path}').Sddl`).join('; ');
        const diagnostic = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
        console.error('Owned fixture ACLs:\n' + diagnostic.stdout);
        const state = process.env.HAPPY_WINDOWS_SANDBOX_HOME;
        if (state) {
            const logs = join(state, '.sandbox');
            for (const name of (await readdir(logs).catch(() => [])).filter(name => name.endsWith('.log')).sort().slice(-3)) {
                const lines = (await readFile(join(logs, name), 'utf8')).split(/\r?\n/).filter(line => line.includes(root) || /read ACL|read-acl-only|prepare selected project/.test(line));
                console.error('Owned read ACL trace:\n' + lines.slice(-50).join('\n'));
            }
        }
    }
    throw error;
} finally {
    await client?.shutdown().catch(() => undefined);
    daemon.kill('SIGTERM');
    await Promise.race([new Promise(done => daemon.once('exit', done)), pause(2000)]);
    if (daemon.exitCode === null) daemon.kill('SIGKILL');
    fixture.closeAllConnections(); await new Promise(done => fixture.close(done));
    if (!resolve(root).startsWith(resolve(homedir()) + sep) || !root.includes('cyberfi-skill-smoke-')) throw Error('Unsafe owned fixture cleanup');
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

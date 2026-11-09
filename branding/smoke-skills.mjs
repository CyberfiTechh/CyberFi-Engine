import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageCommandTools } from './smoke-command-tools.mjs';
import { deepMcpCalls, deepMcpConfig, deepMcpMarker } from './smoke-mcp-deep.mjs';

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
        createProject: body => json('POST', 'v0/projects', body),
        createAgent: body => json('POST', 'v0/agents', body),
        sendMessage: (id, body) => json('POST', `v0/agents/${encodeURIComponent(id)}/send`, body),
        getMessages: id => json('GET', `v0/agents/${encodeURIComponent(id)}/messages?limit=100`),
        getMode: id => json('GET', `v0/agents/${encodeURIComponent(id)}/mode`),
        shutdown: () => json('POST', 'v0/shutdown'),
    };
}

const binary = resolve(process.argv[2]);
const windows = process.platform === 'win32';
const profile = homedir();
const temporary = windows ? process.env.RUNNER_TEMP : profile;
if (windows) {
    assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
        process.env.GITHUB_REPOSITORY === 'CyberfiTechh/CyberFi-Engine', 'Use a disposable owned Windows runner for this fixed-path test');
    assert(typeof temporary === 'string' && isAbsolute(temporary) &&
        (isAbsolute(relative(profile, temporary)) || relative(profile, temporary).startsWith('..' + sep)),
        'The Windows smoke workspace must be outside the real user profile');
}
const fixtureRoot = await mkdtemp(join(temporary, 'cyberfi-skill-smoke-'));
const root = windows ? join(profile, '.pdr-kocum-agent') : join(fixtureRoot, 'home');
if (windows) await mkdir(root);
const externalProject = join(fixtureRoot, 'outside-workspace');
await mkdir(externalProject);
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
const mcpConfig = join(root, process.platform === 'darwin' ? 'Happy/Config' : 'happy/config', 'mcp.toml');
await mkdir(dirname(mcpConfig), { recursive: true });
if (windows) await writeFile(join(dirname(mcpConfig), 'happy.toml'),
    '[skills]\ndirectories = ' + JSON.stringify([dirname(role)]) + '\n');

const mcpFixture = fileURLToPath(new URL('../../happy-agent-modules/tests/mcp/fixtures/stdioServer.mjs', import.meta.url));
await writeFile(mcpConfig, `[mcp_servers.math_core]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([mcpFixture, 'owned-native'])}\nstartup_timeout_sec = 15\ntool_timeout_sec = 15\n\n` + deepMcpConfig);

const deepServers = [...new Set(deepMcpCalls.map(call => call.arguments.server))];
const deepList = server => ({ name: 'list_mcp_tools', arguments: { server } });
const rgCommand = () => {
    const windows = process.platform === 'win32';
    const managed = JSON.parse(commandTools.HAPPY_AGENT_COMMAND_TOOL_READ_PATHS)[1];
    const exact = join(managed, windows ? 'rg.exe' : 'rg');
    return windows
        ? `$ErrorActionPreference = 'Stop'; if ((Get-Command rg).Source -ine '${exact.replaceAll("'", "''")}') { exit 2 }; rg --version`
        : `test "$(command -v rg)" = '${exact.replaceAll("'", "'\\''")}' && rg --version`;
};
const shellCheck = sentinel => {
    const cmd = process.platform === 'win32'
        ? `${rgCommand()}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; $npmVersion = npm.cmd --version; if ($LASTEXITCODE -ne 0 -or $npmVersion -notmatch '^[0-9]+[.][0-9]+[.][0-9]+') { exit 1 }; Write-Output '${sentinel}'`
        : `${rgCommand()} && printf '%s\\n' '${sentinel}'`;
    return { name: 'exec_command', arguments: { cmd, yield_time_ms: 30000 } };
};
const auth = randomBytes(24).toString('hex');
const stages = new Map();
const sessionKinds = new Map();
const readCommand = path => process.platform === 'win32'
    ? `Get-Content -LiteralPath '${path.replaceAll("'", "''")}' -ErrorAction Stop`
    : `cat '${path.replaceAll("'", "'\\''")}'`;
const fixture = createServer(async (request, response) => {
    try {
        assert.equal(request.headers.authorization, `Bearer ${auth}`);
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString());
        const key = input.options?.sessionId;
        const transcript = JSON.stringify(input.context?.messages ?? input.messages ?? []);
        if (!sessionKinds.has(key)) sessionKinds.set(key,
            transcript.includes('FULL_ACCESS_GRANDCHILD_CHECK') ? 'full-grandchild' :
            transcript.includes('FULL_ACCESS_CHILD_CHECK') ? 'full-child' :
            transcript.includes('CHILD_SKILL_CHECK') ? 'read-only-child' : 'other');
        // A parent followup changes an existing child's next tool namespace, not its provider session.
        if (sessionKinds.get(key) === 'read-only-child' && transcript.includes('EXISTING_CHILD_FULL_CHECK')) {
            sessionKinds.set(key, 'existing-full-child'); stages.set(key, 0);
        }
        const kind = sessionKinds.get(key);
        let content = [{ type: 'text', text: 'Owned smoke complete.' }];
        if ((kind === 'full-child' || kind === 'full-grandchild' || kind === 'existing-full-child') && !String(key).endsWith(':title')) {
            const stage = stages.get(key) ?? 0;
            const sentinel = kind === 'full-child' ? 'FULL_ACCESS_CHILD_SENTINEL' : kind === 'existing-full-child' ? 'EXISTING_CHILD_FULL_SENTINEL' : 'FULL_ACCESS_GRANDCHILD_SENTINEL';
            const calls = [
                ['exec_command', shellCheck(sentinel).arguments],
                ['call_mcp_tool', { server: 'Math Core', name: 'echo', arguments: { text: sentinel + '_MCP' } }],
                ...(kind === 'full-child' ? [...deepServers.map(deepList), ...deepMcpCalls].map(call => [call.name, call.arguments]) : []),
                ...(kind === 'full-child' ? [['create_agent', { title: 'Owned full grandchild', model: 'openai/gym', provider: 'gym', effort: 'off', read_only: true, text: 'FULL_ACCESS_GRANDCHILD_CHECK Run only the owned shell and MCP checks.' }]] : []),
            ];
            if (stage < calls.length) {
                stages.set(key, stage + 1);
                content = [{ type: 'tool_call', callId: `owned-full-${stage}`, name: calls[stage][0], arguments: calls[stage][1] }];
            } else {
                const signals = [...transcript.matchAll(/Process (?:running with session ID (\d+)|exited with code -?\d+)/g)];
                const pending = signals.at(-1)?.[1];
                if (pending) content = [{ type: 'tool_call', callId: `owned-poll-${randomUUID()}`, name: 'write_stdin', arguments: { session_id: Number(pending), chars: '', yield_time_ms: 30000 } }];
            }
        } else if (kind === 'read-only-child' && !String(key).endsWith(':title')) {
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
const environment = { ...process.env };
for (const name of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(name) || /^(AWS_|AZURE_|GOOGLE_|GEMINI_|ANTHROPIC_|OPENAI_|GROK_|XAI_|BEDROCK_)/i.test(name)) delete environment[name];
const commandTools = await stageCommandTools(root, environment);
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const daemon = spawn(binary, ['run'], {
    cwd: join(root, 'workspace'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...environment, ...commandTools, HOME: root, USERPROFILE: windows ? profile : root, HAPPY_HOME_DIR: happyHome,
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
function deepListing(tool, server) {
    assert.equal(tool.status, 'completed');
    for (const call of deepMcpCalls.filter(call => call.arguments.server === server))
        assert(output(tool).includes(call.arguments.name), 'MCP definition missing from the tool catalog: ' + call.arguments.name);
}
async function request(agentId, tool, permissionMode = 'read_only') {
    const id = `s${randomUUID().replaceAll('-', '').slice(0, 23)}`;
    await client.sendMessage(agentId, { id, text: 'Isolated native skill check', delivery: 'queue',
        content: [{ type: 'tool_call_request', ...tool }],
        mode: { effort: 'off', modelId: 'openai/gym', providerId: 'gym', permissionMode, serviceTier: null } });
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
    assert.equal(read.status, 'completed', 'Owned role read failed: ' + String(output(read)).slice(0, 1000)); assert(output(read).includes('OWNED_ROLE_INSTRUCTIONS'));
    const reference = await shellRead(parent, support);
    assert(reference.includes('OWNED_SUPPORT_SENTINEL'), 'Restricted parent support read failed: ' + reference);
    const { project } = await client.createProject({ path: externalProject });
    const { agent: externalAgent } = await client.createAgent({ workspaceId: project.id, title: 'Owned external-workspace smoke' });
    if (windows) {
        const restrictedRg = await request(externalAgent.id, { name: 'exec_command', arguments: { cmd: rgCommand(), yield_time_ms: 30000 } });
        assert.equal(restrictedRg.status, 'completed');
        assert.match(output(restrictedRg), /ripgrep 15[.]2[.]0/u);
        assert(output(restrictedRg).includes('Process exited with code 0'), 'Restricted native ripgrep failed outside the home');
        const deniedOutside = await shellRead(externalAgent.id, unrelated);
        assert(!deniedOutside.includes('UNRELATED_PRIVATE_SENTINEL'), 'External workspace obtained unrelated private data');
        const managedRg = JSON.parse(commandTools.HAPPY_AGENT_COMMAND_TOOL_READ_PATHS)[1];
        const supervisor = resolve('packages/happy-agent-supervisor/native/target/release/happy-agent-supervisor.exe');
        const state = process.env.HAPPY_WINDOWS_SANDBOX_HOME;
        assert(typeof state === 'string' && isAbsolute(state), 'Owned native Windows sandbox state required');
        const marker = 'NARROWER_DENY_MUST_NOT_START_PROCESS';
        for (const deniedPath of [dirname(managedRg), join(managedRg, 'rg.exe')]) {
            const policy = { mode: 'read_only', allowedReadPaths: [], deniedReadPaths: [profile, deniedPath], network: { egress: false, localBinding: false } };
            const refusal = spawnSync(supervisor, ['--policy', JSON.stringify(policy), '--state-dir', state, '--cwd', externalProject, '--',
                join(process.env.SystemRoot, 'System32/cmd.exe'), '/d', '/c', 'echo ' + marker],
                { encoding: 'utf8', windowsHide: true, timeout: 30000 });
            assert.equal(refusal.status, 125);
            assert.match(refusal.stderr, /restricted command refused: a read denial overlaps a CyberFi command runtime/u);
            assert(!refusal.stdout.includes(marker), 'Narrower deny started a process after an earlier grant');
        }
        const allowedAgain = await request(externalAgent.id, { name: 'exec_command', arguments: { cmd: rgCommand(), yield_time_ms: 30000 } });
        assert.equal(allowedAgain.status, 'completed');
        assert.match(output(allowedAgain), /ripgrep 15[.]2[.]0/u);
        console.log('Owned Windows external restricted ripgrep and warm narrower denials passed.');

    }
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
    const fullCreated = await request(parent, { name: 'create_agent', arguments: { title: 'Owned full child', model: 'openai/gym', provider: 'gym', effort: 'off', read_only: true, text: 'FULL_ACCESS_CHILD_CHECK Run only owned shell, MCP and nested inheritance checks.' } }, 'full_access');
    assert.equal(fullCreated.status, 'completed');
    const fullChildId = /Created collaborator ([a-z0-9]+)/.exec(output(fullCreated))?.[1]; assert(fullChildId, 'Missing full child ID');
    async function fullProof(id, sentinel, nested) {
        return await wait(async () => {
            if ((await client.getMode(id)).mode?.permissionMode !== 'full_access') return undefined;
            const calls = toolsOf(await client.getMessages(id));
            const shellCalls = calls.filter(tool => ['exec_command', 'write_stdin'].includes(tool.name) && tool.status !== 'running');
            const shell = shellCalls.find(tool => output(tool).includes(sentinel));
            const mcp = calls.find(tool => tool.name === 'call_mcp_tool' && tool.status !== 'running');
            if (!shell || !mcp) return undefined;
            assert.equal(shell.status, 'completed'); assert(output(shell).includes(sentinel));
            assert(shellCalls.some(tool => output(tool).includes('ripgrep 15.2.0')), 'Native ripgrep result missing');
            if (!shellCalls.some(tool => output(tool).includes('Process exited with code 0'))) return undefined;
            assert.equal(mcp.status, 'completed', 'Owned child MCP failed: ' + String(output(mcp)).slice(0, 1500)); assert(output(mcp).includes('owned-native:' + sentinel + '_MCP'));
            if (!nested) return true;
            const listings = calls.filter(tool => tool.name === 'list_mcp_tools' && tool.status !== 'running');
            const finished = calls.filter(tool => tool.name === 'call_mcp_tool' && tool.status === 'completed');
            if (listings.length < deepServers.length || finished.length < deepMcpCalls.length + 1) return undefined;
            for (const [index, server] of deepServers.entries()) deepListing(listings[index], server);
            for (const call of deepMcpCalls)
                assert(finished.some(tool => output(tool).includes(deepMcpMarker(call.arguments))), 'Missing child MCP dispatch: ' + call.arguments.name);
            const created = calls.find(tool => tool.name === 'create_agent' && tool.status !== 'running');
            if (!created) return undefined;
            assert.equal(created.status, 'completed');
            const grandchild = /Created collaborator ([a-z0-9]+)/.exec(output(created))?.[1];
            assert(grandchild, 'Missing full grandchild ID'); return grandchild;
        }, 240000);
    }
    const fullGrandchildId = await fullProof(fullChildId, 'FULL_ACCESS_CHILD_SENTINEL', true);
    await fullProof(fullGrandchildId, 'FULL_ACCESS_GRANDCHILD_SENTINEL', false);
    assert.equal((await client.getMode(childId)).mode?.permissionMode, 'read_only');
    const followed = await request(parent, { name: 'send_agent_message', arguments: { toAgentId: childId, explanation: 'Continue owned full access check', text: 'EXISTING_CHILD_FULL_CHECK Run only the owned native shell and MCP checks.' } }, 'full_access');
    assert.equal(followed.status, 'completed', 'Owned existing-child steering failed: ' + String(output(followed) ?? '').slice(0, 1024));
    await fullProof(childId, 'EXISTING_CHILD_FULL_SENTINEL', false);
    const parentShell = await request(externalAgent.id, shellCheck('FULL_ACCESS_PARENT_SENTINEL'), 'full_access');
    assert.equal(parentShell.status, 'completed');
    assert.match(output(parentShell), /ripgrep 15\.2\.0/u);
    assert(output(parentShell).includes('FULL_ACCESS_PARENT_SENTINEL') && output(parentShell).includes('Process exited with code 0'));
    for (const server of deepServers) deepListing(await request(parent, deepList(server), 'full_access'), server);
    for (const call of deepMcpCalls) {
        const result = await request(parent, call, 'full_access');
        assert.equal(result.status, 'completed');
        assert(output(result).includes(deepMcpMarker(call.arguments)), 'Missing main-agent MCP dispatch: ' + call.arguments.name);
    }
    const catalog = await request(parent, { name: 'list_mcp_tools', arguments: { server: 'Math Core' } }, 'full_access');
    assert.equal(catalog.status, 'completed', 'Owned parent MCP list failed: ' + String(output(catalog)).slice(0, 1500)); assert(output(catalog).includes('echo'), 'Native MCP display alias did not resolve');
    const echo = await request(parent, { name: 'call_mcp_tool', arguments: { server: 'Math Core', name: 'echo', arguments: { text: 'NATIVE_ALIAS_SENTINEL' } } }, 'full_access');
    assert.equal(echo.status, 'completed'); assert(output(echo).includes('owned-native:NATIVE_ALIAS_SENTINEL'), 'Native MCP alias tool invocation failed');
    for (const name of ['grok_web_search', 'bedrock_web_search']) {
        const unavailable = await request(parent, { name, arguments: { query: 'Owned unavailable-account check' } }, 'full_access');
        assert.equal(unavailable.status, 'completed');
        assert(output(unavailable).includes('No search was performed'), 'Missing optional account was not reported as unavailable');
    }
    assert.equal(await readFile(support, 'utf8'), 'OWNED_SUPPORT_SENTINEL');
    assert.equal(await readFile(unrelated, 'utf8'), 'UNRELATED_PRIVATE_SENTINEL');
    console.log(JSON.stringify({ actualBinary: true, parentSkill: true, parentSupport: true, readOnlyChildSkill: true, readOnlyChildSupport: true, unrelatedPrivateDenied: true, sentinelsIntact: true, nativeMcpAlias: true, optionalSearchUnavailableNeutral: true, fullAccessChildAndGrandchild: true, nativeFullAccessChildShellAndMcp: true, existingChildFullShellAndMcp: true, realRipgrepMainAndDescendants: true, windowsRestrictedOutsideHome: windows, windowsNarrowerDenyAfterWarm: windows, deepMcpListedAndCalledMain: 31, deepMcpListedAndCalledChild: 31, mcpBackendFixture: true, paidInference: false }));
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
    if (dirname(resolve(fixtureRoot)) !== resolve(temporary) || !fixtureRoot.includes('cyberfi-skill-smoke-')) throw Error('Unsafe owned fixture cleanup');
    if (windows) {
        assert.equal(resolve(root), resolve(profile, '.pdr-kocum-agent'));
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

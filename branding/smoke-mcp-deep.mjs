import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const script = fileURLToPath(import.meta.url);
const catalog = JSON.parse(gunzipSync(readFileSync(new URL('./mcp-deep-catalog.json.gz', import.meta.url)), { maxOutputLength: 600_000 }));
assert.deepEqual(Object.fromEntries(Object.entries(catalog).map(([server, tools]) => [server, tools.length])), {
    math_charts: 3, pdrkocum_ai_charts: 3, rea: 25,
});

export const deepMcpCalls = Object.entries(catalog).flatMap(([server, tools]) => tools.map(({ name }) => ({
    name: 'call_mcp_tool',
    arguments: { server, name, arguments: {} },
})));
export const deepMcpMarker = ({ server, name }) => 'owned-deep-mcp:' + server + ':' + name;
export const deepMcpConfig = Object.keys(catalog).map(server =>
    '[mcp_servers.' + server + ']\ncommand = ' + JSON.stringify(process.execPath) +
    '\nargs = ' + JSON.stringify([script, server]) + '\nstartup_timeout_sec = 15\ntool_timeout_sec = 15\n',
).join('\n');

if (process.argv[1] && resolve(process.argv[1]) === script) {
    const server = process.argv[2];
    assert(Object.hasOwn(catalog, server), 'Unknown test MCP server');
    const tools = catalog[server];
    for await (const line of createInterface({ input: process.stdin })) {
        const { id, method, params } = JSON.parse(line);
        if (id === undefined) continue;
        let result;
        switch (method) {
            case 'initialize':
                result = { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: server, version: '1' } };
                break;
            case 'tools/list':
                result = { tools };
                break;
            case 'tools/call':
                assert(tools.some(tool => tool.name === params.name), 'Unexpected test MCP tool');
                result = { content: [{ type: 'text', text: deepMcpMarker({ server, name: params.name }) }] };
                break;
            default:
                assert.fail('Unexpected test MCP method ' + method);
        }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
    }
}

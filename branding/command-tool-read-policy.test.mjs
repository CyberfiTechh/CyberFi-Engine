import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, sep } from 'node:path';
import { test } from 'node:test';
import { cyberFiCommandToolReadDirectories } from './CommandToolReadPolicy.ts';

const layouts = {
    'win32-x64': 'ripgrep-15.2.0-x86_64-pc-windows-msvc',
    'darwin-x64': 'ripgrep-15.2.0-x86_64-apple-darwin',
    'darwin-arm64': 'ripgrep-15.2.0-aarch64-apple-darwin',
};
function fixture(run) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'cyberfi-command-policy-')));
    const home = join(root, 'home'), managed = join(home, '.pdr-kocum-agent');
    const agentHome = join(managed, '.happy', 'agent'), base = join(managed, 'mcp-runtime', 'runtimes');
    mkdirSync(agentHome, { recursive: true });
    const paths = Object.fromEntries(Object.entries(layouts).map(([target, rg]) => [target, [join(base, 'python-' + target, 'python'), join(base, 'rg-' + target, rg)]]));
    for (const pair of Object.values(paths)) for (const path of pair) mkdirSync(path, { recursive: true });
    const query = (raw, target = process.platform + '-' + process.arch, selectedAgentHome = agentHome) => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform'), arch = Object.getOwnPropertyDescriptor(process, 'arch');
        const separator = target.lastIndexOf('-');
        try {
            Object.defineProperty(process, 'platform', { value: target.slice(0, separator) });
            Object.defineProperty(process, 'arch', { value: target.slice(separator + 1) });
            return cyberFiCommandToolReadDirectories(selectedAgentHome, raw);
        } finally {
            Object.defineProperty(process, 'platform', platform); Object.defineProperty(process, 'arch', arch);
        }
    };
    try { run({ root, home, managed, agentHome, base, paths, query }); }
    finally {
        const fromTemp = relative(realpathSync(tmpdir()), realpathSync(root));
        assert(fromTemp !== '' && fromTemp !== '..' && !isAbsolute(fromTemp) && !fromTemp.startsWith('..' + sep) && basename(root).startsWith('cyberfi-command-policy-'));
        rmSync(root, { recursive: true, force: true });
    }
}

test('accepts only the exact native Windows and Mac installer pairs as canonical read roots', () => fixture(({ paths, query }) => {
    for (const [target, pair] of Object.entries(paths)) assert.deepEqual(query(JSON.stringify(pair), target), pair.map(path => realpathSync(path)));
}));

test('fails closed on malformed, broad, unknown, relative, duplicate or wrong-platform grants', () => fixture(({ home, managed, agentHome, base, paths, query }) => {
    const pair = paths['win32-x64'];
    for (const raw of [undefined, '', 'not-json', '{}', 'null', JSON.stringify([pair[0]]), JSON.stringify([...pair, base]), JSON.stringify([pair[0], pair[0]]), JSON.stringify([pair[0], 4]), JSON.stringify(['relative/python', pair[1]]), JSON.stringify([parse(base).root, pair[1]]), JSON.stringify([home, pair[1]]), JSON.stringify([managed, pair[1]]), JSON.stringify([agentHome, pair[1]]), JSON.stringify([dirname(agentHome), pair[1]]), JSON.stringify([base + '-lookalike', pair[1]]), JSON.stringify([join(base, 'other'), pair[1]]), JSON.stringify(paths['darwin-x64']), ' '.repeat(16_385)]) assert.deepEqual(query(raw, 'win32-x64'), []);
}));

test('rejects symlink roots redirected to home, agent token parent, config or outside', () => fixture(({ root, home, managed, agentHome, paths, query }) => {
    const pair = paths['win32-x64'], leaf = pair[0], original = leaf + '-original';
    const config = join(managed, 'happy', 'config'); mkdirSync(config, { recursive: true });
    writeFileSync(join(agentHome, 'token'), 'PRIVATE_SENTINEL');
    renameSync(leaf, original);
    try {
        for (const target of [home, agentHome, dirname(agentHome), config, root, pair[1]]) {
            symlinkSync(target, leaf, process.platform === 'win32' ? 'junction' : 'dir');
            try { assert.deepEqual(query(JSON.stringify(pair), 'win32-x64'), []); }
            finally { unlinkSync(leaf); }
        }
    } finally { renameSync(original, leaf); }
}));

test('rejects a redirected runtime ancestor even when both expected leaf names exist', () => fixture(({ root, base, paths, query }) => {
    const moved = join(root, 'outside-runtimes'); renameSync(base, moved);
    symlinkSync(moved, base, process.platform === 'win32' ? 'junction' : 'dir');
    try { assert.deepEqual(query(JSON.stringify(paths['win32-x64']), 'win32-x64'), []); }
    finally {
        unlinkSync(base);
        assert.deepEqual(query(JSON.stringify(paths['win32-x64']), 'win32-x64'), []);
        renameSync(moved, base);
    }
}));

test('does not grant a file in place of an executable directory', () => fixture(({ paths, query }) => {
    const pair = paths['win32-x64']; rmdirSync(pair[0]); writeFileSync(pair[0], 'not a directory');
    assert.deepEqual(query(JSON.stringify(pair), 'win32-x64'), []);
}));

test('rejects two case variants of one canonical Windows directory', { skip: process.platform !== 'win32' }, () => fixture(({ paths, query }) => {
    const python = paths['win32-x64'][0];
    assert.deepEqual(query(JSON.stringify([python.toLowerCase(), python.toUpperCase()]), 'win32-x64'), []);
}));

test('allows an alias above the managed root while still storing only canonical narrow roots', () => fixture(({ home, managed, paths, query }) => {
    const alias = join(home, 'managed-alias');
    symlinkSync(managed, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const pair = paths['win32-x64'];
    const rawPaths = pair.map(path => join(alias, relative(managed, path)));
    assert.deepEqual(query(JSON.stringify(rawPaths), 'win32-x64', join(alias, '.happy', 'agent')), pair.map(path => realpathSync(path)));
}));

test('keeps either installed runtime readable while the other expected runtime is missing', () => {
    for (const absent of [0, 1]) fixture(({ paths, query }) => {
        const pair = paths['win32-x64'];
        rmdirSync(pair[absent]);
        assert.deepEqual(query(JSON.stringify(pair), 'win32-x64'), [realpathSync(pair[1 - absent])]);
        rmdirSync(dirname(pair[absent]));
        assert.deepEqual(query(JSON.stringify(pair), 'win32-x64'), [realpathSync(pair[1 - absent])]);
    });
});

test('still rejects all grants when the missing runtime parent redirects to home', () => fixture(({ home, paths, query }) => {
    const pair = paths['win32-x64'], parent = dirname(pair[1]), original = parent + '-original';
    renameSync(parent, original);
    symlinkSync(home, parent, process.platform === 'win32' ? 'junction' : 'dir');
    try { assert.deepEqual(query(JSON.stringify(pair), 'win32-x64'), []); }
    finally { unlinkSync(parent); renameSync(original, parent); }
}));

test('does not treat a dangling runtime symlink as a normally uninstalled runtime', () => fixture(({ root, paths, query }) => {
    const pair = paths['win32-x64']; rmdirSync(pair[1]);
    symlinkSync(join(root, 'absent-target'), pair[1], process.platform === 'win32' ? 'junction' : 'dir');
    try { assert.deepEqual(query(JSON.stringify(pair), 'win32-x64'), []); }
    finally { unlinkSync(pair[1]); }
}));

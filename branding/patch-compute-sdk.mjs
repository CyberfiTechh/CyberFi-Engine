import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';

const anchor = `            ...(permissions.allowedReadPaths === undefined
                ? {}
                : { allowedReadPaths: permissions.allowedReadPaths }),`;
const replacement = `            ...(permissions.allowedReadPaths === undefined && (options.hostPolicy?.readableDirectories?.length ?? 0) === 0
                ? {}
                : { allowedReadPaths: [...(permissions.allowedReadPaths ?? []), ...existingHostPaths(canonicalCwd, options.hostPolicy?.readableDirectories ?? [])] }),`;
const shellSdkSha256 = '349fb07a7eb1501bc127908a49a2f8d54ad0400a9cf51c037b64cacd3dc61754';
const hash = value => createHash('sha256').update(value).digest('hex');
export function patchSdk(directory, verify = false) {
    const root = realpathSync(resolve(directory));
    const entries = ['happy-agent', 'happy-agent-modules'].map(name => realpathSync(createRequire(join(root, 'packages', name, 'package.json')).resolve('@slopus/happy-agent-compute')));
    assert.equal(entries[0], entries[1], 'Engine and modules must use the same canonical SDK');
    const packageRoot = dirname(dirname(entries[0]));
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(metadata.name, '@slopus/happy-agent-compute');
    assert.equal(metadata.version, '0.1.30', 'Only the pinned published SDK is supported');
    const target = realpathSync(join(dirname(entries[0]), 'host/createHostShell.js'));
    const shell = realpathSync(join(dirname(entries[0]), 'processes/impl/shellCommandArgs.js'));
    for (const file of [target, shell]) {
        const fromRoot = relative(root, file);
        assert(!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith('../') && !fromRoot.startsWith('..\\'), 'Never modify an SDK outside this checkout');
    }
    const shellSource = join(root, 'packages', 'happy-agent-compute', 'sources', 'processes', 'impl', 'shellCommandArgs.ts');
    const shellReplacement = stripTypeScriptTypes(readFileSync(shellSource, 'utf8'));
    assert(shellReplacement.includes('$OutputEncoding = [Text.UTF8Encoding]'), 'Unicode shell source patch is missing');
    const before = readFileSync(target, 'utf8');
    if (verify) {
        assert.equal(before.split(replacement).length - 1, 1, 'Patched SDK forwarding is missing');
        assert(!before.includes(anchor));
        assert.equal(readFileSync(shell, 'utf8'), shellReplacement, 'Unicode shell SDK differs from the tested source');
    } else {
        assert.equal(before.split(anchor).length - 1, 1, 'Published SDK anchor must match exactly once');
        assert(!before.includes(replacement));
        assert.equal(hash(readFileSync(shell)), shellSdkSha256, 'Published shell SDK bytes must match the pinned version');
        const after = before.replace(anchor, replacement);
        // pnpm may hardlink this installed file to its shared content-addressed store.
        // Detach the checkout's entry before writing; never mutate a shared inode.
        unlinkSync(target);
        writeFileSync(target, after, 'utf8');
        assert.equal(readFileSync(target, 'utf8'), after);
        unlinkSync(shell);
        writeFileSync(shell, shellReplacement, 'utf8');
        assert.equal(readFileSync(shell, 'utf8'), shellReplacement);
    }
    return { sdkVersion: metadata.version, sameCanonicalSdk: true, sdkReadRootsForwarded: true, sdkUnicodeShellSha256: hash(readFileSync(shell)), sdkSha256: hash(readFileSync(target)) };
}
function selfCheck() {
    const root = mkdtempSync(join(tmpdir(), 'cyberfi-sdk-check-'));
    try {
        for (const name of ['happy-agent', 'happy-agent-modules']) {
            mkdirSync(join(root, 'packages', name), { recursive: true });
            writeFileSync(join(root, 'packages', name, 'package.json'), '{}');
        }
        const sdk = join(root, 'node_modules', '@slopus', 'happy-agent-compute');
        mkdirSync(join(sdk, 'dist', 'host'), { recursive: true });
        const metadata = { name: '@slopus/happy-agent-compute', version: '0.1.30', main: 'dist/index.js' };
        writeFileSync(join(sdk, 'package.json'), JSON.stringify(metadata));
        writeFileSync(join(sdk, 'dist', 'index.js'), '');
        const store = join(root, 'unchanged-store-original.js');
        writeFileSync(store, anchor);
        linkSync(store, join(sdk, 'dist', 'host', 'createHostShell.js'));
        const shellSource = join(root, 'packages', 'happy-agent-compute', 'sources', 'processes', 'impl');
        mkdirSync(shellSource, { recursive: true });
        writeFileSync(join(shellSource, 'shellCommandArgs.ts'), 'export const output: string = "$OutputEncoding = [Text.UTF8Encoding]";');
        mkdirSync(join(sdk, 'dist', 'processes', 'impl'), { recursive: true });
        const shellStore = join(root, 'unchanged-shell-store.js');
        const pinnedShell = "import { basename } from \"node:path\";\n/** Shell syntax is selected from the executable; arguments remain an argv vector. */\nexport function shellCommandArgs(shell, command) {\n    const name = basename(shell).toLowerCase();\n    if (name === \"cmd.exe\" || name === \"cmd\")\n        return [\"/d\", \"/s\", \"/c\", command];\n    if ([\"powershell.exe\", \"powershell\", \"pwsh.exe\", \"pwsh\"].includes(name))\n        return [\"-NoLogo\", \"-NoProfile\", \"-NonInteractive\", \"-Command\", command];\n    return [\"-lc\", command];\n}\n//# sourceMappingURL=shellCommandArgs.js.map";
        writeFileSync(shellStore, pinnedShell);
        linkSync(shellStore, join(sdk, 'dist', 'processes', 'impl', 'shellCommandArgs.js'));
        patchSdk(root); patchSdk(root, true);
        assert.equal(readFileSync(store, 'utf8'), anchor, 'Shared hardlink source changed');
        assert.equal(readFileSync(shellStore, 'utf8'), pinnedShell, 'Shared shell hardlink source changed');
        writeFileSync(join(sdk, 'package.json'), JSON.stringify({ ...metadata, version: '0.1.31' }));
        assert.throws(() => patchSdk(root, true), /pinned published SDK/);
        writeFileSync(join(sdk, 'package.json'), JSON.stringify(metadata));
        writeFileSync(join(sdk, 'dist', 'host', 'createHostShell.js'), anchor + anchor);
        assert.throws(() => patchSdk(root), /exactly once/);
        const other = join(root, 'different-resolutions');
        for (const name of ['happy-agent', 'happy-agent-modules']) {
            const client = join(other, 'packages', name);
            mkdirSync(client, { recursive: true }); writeFileSync(join(client, 'package.json'), '{}');
            const separate = join(client, 'node_modules', '@slopus', 'happy-agent-compute');
            mkdirSync(join(separate, 'dist'), { recursive: true });
            writeFileSync(join(separate, 'package.json'), JSON.stringify(metadata));
            writeFileSync(join(separate, 'dist', 'index.js'), '');
        }
        assert.throws(() => patchSdk(other), /same canonical SDK/);
        console.log('SDK self-check passed: exact version, unique anchor, shared canonical resolution, hardlink preserved.');
    } finally {
        assert(relative(realpathSync(tmpdir()), realpathSync(root)).startsWith('cyberfi-sdk-check-'));
        rmSync(root, { recursive: true, force: true });
    }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    if (process.argv[2] === '--self-check') selfCheck();
    else console.log(JSON.stringify(patchSdk(process.argv[2], process.argv.includes('--verify'))));
}

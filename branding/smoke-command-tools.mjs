import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const archives = {
    'win32-x64': ['x86_64-pc-windows-msvc.zip', '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5'],
    'darwin-x64': ['x86_64-apple-darwin.tar.gz', 'af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1'],
    'darwin-arm64': ['aarch64-apple-darwin.tar.gz', '3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4'],
};

export async function stageCommandTools(root, environment) {
    const target = process.platform + '-' + process.arch;
    const [suffix, sha256] = archives[target];
    const windows = process.platform === 'win32';
    const archive = 'ripgrep-15.2.0-' + suffix;
    const folder = archive.replace(/\.(zip|tar\.gz)$/u, '');
    const runtime = join(root, 'mcp-runtime');
    const rg = join(runtime, 'runtimes', 'rg-' + target, folder);
    const python = join(runtime, 'runtimes', 'python-' + target, 'python');
    const executable = windows ? 'rg.exe' : 'rg';
    const pythonFile = windows ? join(python, 'python.exe') : join(python, 'bin', 'python3');
    await mkdir(rg, { recursive: true });
    await mkdir(dirname(pythonFile), { recursive: true });
    const fetched = await fetch('https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/' + archive, { signal: AbortSignal.timeout(60000) });
    assert(fetched.ok && fetched.body, 'Could not fetch the pinned native ripgrep');
    const pieces = [];
    let bytes = 0;
    for await (const chunk of fetched.body) {
        bytes += chunk.byteLength;
        assert(bytes < 8 * 1024 ** 2, 'Unexpected ripgrep archive size');
        pieces.push(chunk);
    }
    const body = Buffer.concat(pieces);
    assert.equal(createHash('sha256').update(body).digest('hex'), sha256);
    const packed = join(root, archive);
    await writeFile(packed, body, { flag: 'wx' });
    const tar = windows ? join(environment.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
    const data = execFileSync(tar, ['-xOf', packed, folder + '/' + executable], { maxBuffer: 12 * 1024 ** 2, windowsHide: true });
    await writeFile(join(rg, executable), data, { flag: 'wx' });
    await chmod(join(rg, executable), 0o755);
    const pythonCandidates = execFileSync(windows ? 'where.exe' : '/usr/bin/which', [windows ? 'python.exe' : 'python3'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/u);
    let copied = false;
    for (const candidate of pythonCandidates) {
        const file = await stat(candidate).catch(() => undefined);
        if (!file?.isFile() || file.size === 0) continue;
        await copyFile(candidate, pythonFile);
        copied = true;
        break;
    }
    assert(copied, 'Native smoke requires an installed Python executable');
    const generation = randomUUID();
    const receipt = join(runtime, 'command-tools.json');
    await writeFile(receipt, JSON.stringify({ version: 1, generation, state: 'ready' }), { flag: 'wx' });
    if (windows) {
        for (const key of Object.keys(environment)) if (key.toLowerCase() === 'pathext') delete environment[key];
        environment.PATHEXT = '.CMD;.CPL';
    }
    return {
        CYBERFI_COMMAND_TOOLS_STATUS_PATH: receipt,
        CYBERFI_COMMAND_TOOLS_GENERATION: generation,
        HAPPY_AGENT_COMMAND_TOOL_READ_PATHS: JSON.stringify([python, rg]),
    };
}

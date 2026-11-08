import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2]);
const platform = process.argv[3];
assert(['win32', 'darwin'].includes(platform));
const voicePath = 'packages/happy-agent-modules/sources/live/impl/livePrompts.ts';
const originalVoice = execFileSync('git', ['-C', root, 'show', 'HEAD:' + voicePath], { encoding: 'utf8' });
const translatedVoice = readFileSync(join(root, voicePath), 'utf8');
const load = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const beforePrompts = await load(originalVoice);
const afterPrompts = await load(translatedVoice);
assert.deepEqual(Object.keys(afterPrompts), Object.keys(beforePrompts));
assert(afterPrompts.LIVE_VOICE_INSTRUCTIONS.startsWith('Sen CyberFi, tek bir masaüstü penceresinde'));
assert(!Object.values(afterPrompts).join('\n').includes('Happy'));
for (const token of ['list_sidebar', 'read_conversations', 'desktopState', 'agentTargets', 'connectionId', 'agentId', 'sessionSend', 'composerDraftAppend', 'desktopOpen', 'taskCreate', 'sessionModelChange', 'staged', 'Sidebar']) {
  assert(Object.values(beforePrompts).join('\n').includes(token));
  assert(Object.values(afterPrompts).join('\n').includes(token), `Voice tool/protocol identity changed: ${token}`);
}
assert(afterPrompts.VOICE_AGENT_INSTRUCTIONS.includes('{"kind": "agent", "connectionId", "agentId"}'));
assert(afterPrompts.LIVE_VOICE_INSTRUCTIONS.includes('GÖNDERİLMİŞ DEĞİLDİR'));
assert(afterPrompts.LIVE_VOICE_INSTRUCTIONS.includes('aynı isteği asla iki kez devretme'));
const caller = 'packages/happy-agent-modules/sources/live/LiveModule.ts';
assert.equal(readFileSync(join(root, caller), 'utf8').replaceAll('\r\n', '\n'), execFileSync('git', ['-C', root, 'show', 'HEAD:' + caller], { encoding: 'utf8' }).replaceAll('\r\n', '\n'), 'Stored custom prompt handling must remain unchanged');
if (process.argv[4] !== '--source-only') {
  const compiled = readFileSync(join(root, 'packages/happy-agent-modules/dist/live/impl/livePrompts.js'), 'utf8');
  assert(compiled.includes('Sen CyberFi, tek bir masaüstü penceresinde'));
  assert(!compiled.includes('You are Happy, a calm, friendly voice companion'));
  const policy = readFileSync(join(root, 'packages/happy-agent-modules/dist/compute/ComputeModule.js'), 'utf8');
  for (const token of ['readableDirectories', 'globalSkillsRoot', 'globalSkillDirectories', 'skillsHome', 'homeFromRoot']) assert(policy.includes(token), `Missing compiled skill-read policy: ${token}`);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(join(here, 'asset-manifest.json')));
assert.equal(manifest.sourceSha256, 'd576b97d3d7821d05d8647e0f52af64ff8a6d0d8e83e6bbb281d81aacd85e461');
const png = readFileSync(join(here, 'CyberFi-tray.png'));
const ico = readFileSync(join(here, '../windows/CyberFi.ico'));
assert.equal(hash(png), manifest.pngSha256); assert.equal(hash(ico), manifest.icoSha256);
assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), manifest.sizes.length);
for (const [index, size] of manifest.sizes.entries()) {
  const offset = 6 + index * 16;
  assert.equal(ico[offset] || 256, size);
  const image = ico.subarray(ico.readUInt32LE(offset + 12), ico.readUInt32LE(offset + 12) + ico.readUInt32LE(offset + 8));
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), size); assert.equal(image.readUInt32BE(20), size);
}
const nativePath = 'packages/happy-agent-modules/sources/menuBar/native';
const native = join(root, nativePath);
const names = platform === 'win32' ? ['windows/WindowsTray.cs', 'windows/TrayContent.cs'] : ['MenuBarController.swift', 'QuitHappy.swift', 'DaemonSnapshot.swift', 'MenuContent.swift', 'PlanRowView.swift'];
for (const name of names) {
  const path = nativePath + '/' + name;
  const before = execFileSync('git', ['-C', root, 'show', 'HEAD:' + path], { encoding: 'utf8' });
  const after = readFileSync(join(root, path), 'utf8');
  // Translation changes presentation strings, never daemon routes, event names or CLI flags.
  for (const token of before.match(/"(?:\/v0\/[^"\r\n]+|--[^"\r\n]+|(?:provider|config)\.[^"\r\n]+)"/g) ?? []) assert(after.includes(token), token);
  assert(!/(?:title|toolTip|messageText)\s*[:=]\s*"[^"\n]*Happy/.test(after));
}
let binary;
if (platform === 'darwin') {
  const source = readFileSync(join(native, 'StatusIcon.swift'), 'utf8');
  assert(source.includes(png.toString('base64')) && source.includes('image.isTemplate = false'));
  assert(source.includes('width: 20, height: 20') && !source.includes('NSBezierPath'));
  assert(readFileSync(join(native, 'CyberFi-Info.plist'), 'utf8').includes('<key>CFBundleDisplayName</key><string>CyberFi</string>'));
  if (process.argv[4] !== '--source-only') {
    binary = readFileSync(join(root, 'packages/happy-agent-modules/dist/menuBar/bin/happy-menu-bar-darwin-' + process.arch));
    assert(binary.includes(Buffer.from(png.toString('base64'))), 'Compiled Swift helper omitted approved PNG');
    assert(binary.includes(Buffer.from('CFBundleDisplayName')) && binary.includes(Buffer.from('CyberFi')));
  }
} else {
  assert.equal(hash(readFileSync(join(native, 'windows/happy.ico'))), manifest.icoSha256);
  binary = readFileSync(join(root, 'packages/happy-agent-modules/dist/menuBar/bin/happy-menu-bar-win32-x64.exe'));
  assert(binary.includes(ico), 'Compiled Windows helper omitted approved ICO resource');
  assert(binary.includes(Buffer.from('CyberFi', 'utf16le')), 'Compiled helper omitted CyberFi product metadata');
}
const result = { platform, approvedSourceSha256: manifest.sourceSha256, iconSha256: platform === 'darwin' ? manifest.pngSha256 : manifest.icoSha256,
  protocolStringsPreserved: true, voiceToolIdentifiersPreserved: true, builtInVoiceTurkish: true, customPromptCodeUnchanged: true,
  compiledNativeResourceVerified: !!binary, nativeHelperSha256: binary ? hash(binary) : null };
writeFileSync(join(root, 'cyberfi-tray-branding-proof.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const revision = '3d672e414d70804cf9f1b20b44d7243c78e063c3';
const here = dirname(fileURLToPath(import.meta.url));
const literal = (value, windows) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => windows ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0') : c);
const shared = [['Session', 'Oturum'], ['Week', 'Hafta'], ['Month', 'Ay'], ['Current CLI', 'Geçerli CLI'], ['Pool', 'Havuz'], ['Provider', 'Sağlayıcı'], ['Untitled', 'Adsız']];
const windows = {
  'WindowsTray.cs': [['Happy Agent is running', 'CyberFi ajan motoru çalışıyor'], ['Happy Agent is not responding', 'CyberFi ajan motoru yanıt vermiyor'],
    ['Quit Happy', 'CyberFi motorunu kapat'], ['Quitting Happy...', 'CyberFi motoru kapatılıyor...'], ['Quitting Happy', 'CyberFi motoru kapatılıyor'],
    ['Happy tray: ', 'CyberFi: '], ['Reading resource usage...', 'Kaynak kullanımı okunuyor...'],
    ['CPU {0:0.0}% average | Memory {1:N0} MB', 'CPU ortalaması %{0:0.0} | Bellek {1:N0} MB'],
    ['All idle', 'Tümü boşta'], [' working', ' çalışıyor'], [' tokens in 24h', ' token / 24 saat'], [' more', ' daha'],
    ['Happy could not quit. Close Happy Desktop and try again.', 'CyberFi kapatılamadı. Masaüstü uygulamasını kapatıp tekrar deneyin.'],
    ['Could not quit Happy', 'CyberFi kapatılamadı'], ['Resets', 'Yenilenme'], ['Session', 'Oturum']],
  'TrayContent.cs': [...shared, ['\\nWaiting for the first usage reading', '\\nİlk kullanım ölçümü bekleniyor'],
    [' limit reached', ' sınırına ulaşıldı'], ['Out of usage', 'Kullanım hakkı kalmadı'], [', resets ', ', yenilenme: '], ['% left', '% kaldı'],
    ['s', ' sn'], ['m ', ' dk '], ['h ', ' sa '], ['m', ' dk']],
};
const macos = {
  'MenuBarController.swift': [['Quit Happy', 'CyberFi motorunu kapat'], ['Quitting Happy…', 'CyberFi motoru kapatılıyor…'],
    ['Could not quit Happy', 'CyberFi kapatılamadı'], ['Happy Agent', 'CyberFi ajan motoru'], ['OK', 'Tamam']],
  'QuitHappy.swift': [['Happy Desktop could not quit. Close it and try again.', 'Masaüstü uygulaması kapatılamadı. Kapatıp tekrar deneyin.'],
    ['Happy Desktop is still closing. Try again once it has quit.', 'Masaüstü uygulaması kapanıyor. Kapandıktan sonra tekrar deneyin.'],
    ['Happy Agent could not shut down. Please try again.', 'CyberFi ajan motoru kapatılamadı. Tekrar deneyin.']],
  'DaemonSnapshot.swift': shared,
  'MenuContent.swift': [[String.raw`\(compact(snapshot.day.total)) tokens in 24h`, String.raw`\(compact(snapshot.day.total)) token / 24 saat`],
    [String.raw`+\(working.count - sessionLimit) more`, String.raw`+\(working.count - sessionLimit) daha`],
    ['Waiting for Happy Agent…', 'CyberFi ajan motoru bekleniyor…'], ['All idle', 'Tümü boşta'], [String.raw`\(count) working`, String.raw`\(count) çalışıyor`],
    [String.raw`\(seconds)s`, String.raw`\(seconds) sn`], [String.raw`\(minutes)m \(seconds % 60)s`, String.raw`\(minutes) dk \(seconds % 60) sn`],
    [String.raw`\(minutes / 60)h \(minutes % 60)m`, String.raw`\(minutes / 60) sa \(minutes % 60) dk`]],
  'PlanRowView.swift': [[String.raw`\(account)\nWaiting for the first usage reading`, String.raw`\(account)\nİlk kullanım ölçümü bekleniyor`],
    [String.raw`\(window.kind.label): \(Int(window.remainingPercent.rounded()))% left`, String.raw`\(window.kind.label): %\(Int(window.remainingPercent.rounded())) kaldı`],
    [String.raw`\(left), resets \(resetPhrase(reset, precise: true))`, String.raw`\(left), yenilenme: \(resetPhrase(reset, precise: true))`],
    [String.raw`\(limiting.kind.label) limit reached`, String.raw`\(limiting.kind.label) sınırına ulaşıldı`], ['Out of usage', 'Kullanım hakkı kalmadı'],
    [String.raw`, resets \(resetPhrase($0, precise: true))`, String.raw`, yenilenme: \(resetPhrase($0, precise: true))`], ['Resets', 'Yenilenme']],
};
function replace(text, before, after, path) {
  if (!text.includes(before)) throw Error(`Pinned source changed in ${path}: ${before}`);
  return text.replaceAll(before, after);
}
export function translated(text, entries, isWindows, path) {
  for (const [before, after] of entries) {
    const quote = value => literal(value, isWindows).replaceAll('\\\\', '\\');
    text = replace(text, quote(before), quote(after), path);
  }
  return text;
}
export function brandedStatusIcon(original, png) {
  const animation = original.slice(original.indexOf('struct StatusIconAnimation {'));
  if (!animation.startsWith('struct StatusIconAnimation {')) throw Error('Missing pinned animation');
  return `import AppKit
/// Approved CyberFi spiral and circuitry; full color retains its white gaps.
enum StatusIcon {
    private static let size = NSSize(width: 20, height: 20)
    // Phase slots retain the existing animation and reduced-motion contract.
    static let cells = Array(0..<7)
    static let bridge = 3
    private static let source = NSImage(data: Data(base64Encoded: "${png.toString('base64')}")!)!
    static var resting: NSImage { image(strengths: Array(repeating: 1, count: cells.count)) }
    static func image(strengths: [Double]) -> NSImage {
        let opacity = CGFloat(0.6 + 0.4 * (strengths.min() ?? 1))
        let image = NSImage(size: size, flipped: false) { rect in
            NSGraphicsContext.current?.imageInterpolation = .high
            source.draw(in: rect, from: .zero, operation: .sourceOver, fraction: opacity)
            return true
        }
        image.isTemplate = false
        return image
    }
}
/// Existing slow activity pulse; the approved symbol never changes shape.
${animation}`;
}
export function apply(platform, directory) {
  const releaseVersion = process.env.HAPPY_AGENT_RELEASE_VERSION ?? '0.4.124';
  if (releaseVersion.trim() !== releaseVersion || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/.test(releaseVersion) || releaseVersion.split('-')[0].split('.').some(part => Number(part) > 65535)) throw Error('Invalid native engine release version');
  const assemblyVersion = releaseVersion.split('-')[0] + '.0';
  const root = resolve(directory);
  if (execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) throw Error('Unexpected engine source revision');
  const toolFixes = join(here, 'tool-fixes.patch');
  execFileSync('git', ['-C', root, 'apply', '--check', toolFixes]);
  execFileSync('git', ['-C', root, 'apply', toolFixes]);
  const fullAccess = join(here, 'full-access-delegation.patch');
  execFileSync('git', ['-C', root, 'apply', '--check', fullAccess]);
  execFileSync('git', ['-C', root, 'apply', fullAccess]);
  const compatibility = join(here, 'terminal-mcp-compatibility.patch');
  execFileSync('git', ['-C', root, 'apply', '--check', compatibility]);
  execFileSync('git', ['-C', root, 'apply', compatibility]);
  const windowsUnicode = join(here, 'windows-unicode.patch');
  execFileSync('git', ['-C', root, 'apply', '--check', windowsUnicode]);
  execFileSync('git', ['-C', root, 'apply', windowsUnicode]);
  const workspaceArchive = join(here, 'workspace-archive.patch');
  execFileSync('git', ['-C', root, 'apply', '--check', workspaceArchive]);
  execFileSync('git', ['-C', root, 'apply', workspaceArchive]);
  const native = join(root, 'packages/happy-agent-modules/sources/menuBar/native');
  const changes = [];
  if (platform === 'win32') {
    const privatePaths = join(root, 'packages/happy-agent-compute/sources/host/localAgentPaths.ts');
    const privateText = readFileSync(privatePaths, 'utf8').replaceAll('\r\n', '\n');
    changes.push([privatePaths, replace(privateText, '            timeout: 15_000,', '            timeout: 60_000,', privatePaths)]);
    changes.push([join(root, 'packages/happy-agent-compute/tests/host/CyberFiPrivateDirectoryTimeout.test.ts'), readFileSync(join(here, 'PrivateDirectoryTimeout.test.ts'), 'utf8')]);
  }
  const computePolicy = join(root, 'packages/happy-agent-modules/sources/compute/ComputeModule.ts');
  let computeText = replace(readFileSync(computePolicy, 'utf8').replaceAll('\r\n', '\n'), 'import type { PlatformPath } from "node:path";', 'import { isAbsolute, parse, relative, sep, type PlatformPath } from "node:path";\nimport { realpathSync, statSync } from "node:fs";', computePolicy);
  computeText = replace(computeText, 'import { realpathSync, statSync } from "node:fs";', 'import { realpathSync, statSync } from "node:fs";\nimport { cyberFiCommandToolReadDirectories } from "./cyberfiCommandToolReadPolicy.js";', computePolicy);
  computeText = replace(computeText, 'import { cyberFiCommandToolReadDirectories } from "./cyberfiCommandToolReadPolicy.js";', 'import { cyberFiCommandToolReadDirectories } from "./cyberfiCommandToolReadPolicy.js";\nimport { cyberFiCommandToolsEnvironment, cyberFiCommandToolsReadiness } from "./cyberfiCommandToolsReady.js";', computePolicy);
  computeText = replace(computeText, '    #closed = false;', '    #closed = false;\n    #commandToolsReady?: ReturnType<typeof cyberFiCommandToolsReadiness>;', computePolicy);
  computeText = replace(computeText,
    `    get hostPolicy(): ComputeHostPolicy {
        const values = this.#config.configuration.values;`,
    `    get hostPolicy(): ComputeHostPolicy {
        const values = this.#config.configuration.values;
        const canonicalSkillPath = (path: string): string | undefined => {
            try {
                const canonical = realpathSync(path);
                return statSync(canonical).isDirectory() ? canonical : undefined;
            } catch { return undefined; }
        };
        const home = canonicalSkillPath(this.#config.resolveSkillDirectory("~"));`, computePolicy);
  computeText = replace(computeText,
    '            privateDirectories: [this.#config.configuration.paths.agentHome],',
    `            privateDirectories: [this.#config.configuration.paths.agentHome],
            // Installed instructions and their support files stay readable in restricted runs.
            readableDirectories: home === undefined ? [] : [...new Set([
                ...[
                this.#config.globalSkillsRoot,
                ...this.#config.globalSkillDirectories,
                this.#config.configuration.paths.skillsHome,
            ].map(canonicalSkillPath).filter((directory): directory is string => {
                // Store canonical narrow targets, never aliases that can be retargeted to HOME.
                if (directory === undefined || relative(directory, parse(directory).root) === "") return false;
                const homeFromRoot = relative(directory, home);
                return homeFromRoot === ".." || homeFromRoot.startsWith(".." + sep) || isAbsolute(homeFromRoot);
            }),
                ...cyberFiCommandToolReadDirectories(
                    this.#config.configuration.paths.agentHome,
                    process.env.HAPPY_AGENT_COMMAND_TOOL_READ_PATHS,
                ),
            ])],`, computePolicy);
  computeText = replace(computeText, '                this.#guardSessionStarts(agentId, cached);', '                if (here) this.#applyCommandToolsReadiness(cached);\n                this.#guardSessionStarts(agentId, cached);', computePolicy);
  computeText = replace(computeText, '    /** A process whose spawn crosses an abort boundary is part of that abort, not the next turn. */',
    `    #applyCommandToolsReadiness(cached: CachedCompute): void {
        const shell = cached.compute.shell;
        const originalRun = shell.run;
        const originalStart = shell.startSession;
        const ready = this.#commandToolsReady ??= cyberFiCommandToolsReadiness(
            this.#config.configuration.paths.agentHome, process.env,
        );
        const prepared = async (
            permissions: ComputePermissions,
            environment: Readonly<Record<string, string | null>> | undefined,
            signal?: AbortSignal,
        ) => {
            const generation = cached.abortGeneration;
            const paths = await ready(signal,
                () => !cached.closing && !this.#closed && cached.abortGeneration === generation,
            );
            if (paths === undefined) return { permissions };
            return {
                permissions: permissions.mode === "full_access" ? permissions : {
                    ...permissions, allowedReadPaths: [...new Set([...(permissions.allowedReadPaths ?? []), ...paths])],
                },
                environment: cyberFiCommandToolsEnvironment(paths, process.env, environment),
            };
        };
        shell.run = async (options) => await originalRun.call(shell, {
            ...options, ...await prepared(options.permissions, options.environment, options.signal),
        });
        shell.startSession = async (options) => await originalStart.call(shell, {
            ...options, ...await prepared(options.permissions, options.environment),
        });
    }

    /** A process whose spawn crosses an abort boundary is part of that abort, not the next turn. */`, computePolicy);
  changes.push([computePolicy, computeText]);
  changes.push([join(root, 'packages/happy-agent-modules/sources/compute/cyberfiCommandToolReadPolicy.ts'), readFileSync(join(here, 'CommandToolReadPolicy.ts'), 'utf8')]);
  changes.push([join(root, 'packages/happy-agent-modules/sources/compute/cyberfiCommandToolsReady.ts'), readFileSync(join(here, 'CommandToolsReady.ts'), 'utf8')]);
  changes.push([join(root, 'packages/happy-agent-modules/tests/compute/CyberFiCommandToolsReady.test.ts'), readFileSync(join(here, 'CommandToolsReady.test.ts'), 'utf8')]);
  changes.push([join(root, 'packages/happy-agent-modules/tests/compute/CyberFiCommandToolReadPolicy.test.ts'), readFileSync(join(here, 'CommandToolReadPolicy.test.ts'), 'utf8')]);
  const mcpRetryTest = join(root, 'packages/happy-agent-modules/tests/mcp/McpModule.test.ts');
  // The missing gate still forces a timeout; allow a cold child process to initialize after release.
  let mcpRetryText = readFileSync(mcpRetryTest, 'utf8').replaceAll('\r\n', '\n');
  mcpRetryText = replace(mcpRetryText, '{ slow: { ...gate.server, startupTimeoutMs: 300 } }', '{ slow: { ...gate.server, startupTimeoutMs: 2000 } }', mcpRetryTest);
  mcpRetryText = replace(mcpRetryText, '.poll(async () => (await module.listServerPage(ctx, "agent-a")).servers)\n                .toMatchObject([{ name: "slow", status: "failed", toolCount: 0 }]);', '.poll(async () => (await module.listServerPage(ctx, "agent-a")).servers, { timeout: 5000 })\n                .toMatchObject([{ name: "slow", status: "failed", toolCount: 0 }]);', mcpRetryTest);
  const retryEnd = '    });\n\n    it("restarts a server whose process stopped"';
  changes.push([mcpRetryTest, replace(mcpRetryText, retryEnd, '    }, 20_000);\n\n    it("restarts a server whose process stopped"', mcpRetryTest)]);
  changes.push([join(root, 'packages/happy-agent/scripts/cyberfi-smoke-skills.mjs'), readFileSync(join(here, 'smoke-skills.mjs'), 'utf8')]);
  changes.push([join(root, 'packages/happy-agent-modules/tests/skills/CyberFiSkillsReadPolicy.test.ts'), readFileSync(join(here, 'SkillsReadPolicy.test.ts'), 'utf8')]);
  const voice = join(root, 'packages/happy-agent-modules/sources/live/impl/livePrompts.ts');
  if (!readFileSync(voice, 'utf8').includes('You are Happy, a calm, friendly voice companion')) throw Error('Unexpected pinned voice defaults');
  changes.push([voice, readFileSync(join(here, 'livePrompts.ts'), 'utf8')]);
  const voiceGym = join(root, 'packages/happy-agent-gym-tests/tests/happy_api_voice_settings.test.ts');
  changes.push([voiceGym, replace(readFileSync(voiceGym, 'utf8'), '/^You are Happy, a calm, friendly voice/u', '/^Sen CyberFi, tek bir masaüstü penceresinde/u', voiceGym)]);
  for (const [name, entries] of Object.entries(platform === 'win32' ? windows : macos)) {
    const path = join(native, platform === 'win32' ? 'windows' : '', name);
    let text = translated(readFileSync(path, 'utf8'), entries, platform === 'win32', path);
    if (name === 'WindowsTray.cs') text = replace(text, 'using System.Windows.Forms;', `using System.Windows.Forms;\n[assembly: System.Reflection.AssemblyTitle("CyberFi ajan motoru")]\n[assembly: System.Reflection.AssemblyProduct("CyberFi")]\n[assembly: System.Reflection.AssemblyInformationalVersion("${releaseVersion}")]\n[assembly: System.Reflection.AssemblyVersion("${assemblyVersion}")]\n[assembly: System.Reflection.AssemblyFileVersion("${assemblyVersion}")]`, path);
    changes.push([path, text]);
  }
  const build = join(root, 'packages/happy-agent/scripts/build-binary.ts');
  let binary = readFileSync(build, 'utf8');
  binary = replace(binary, 'title: "Happy Agent"', 'title: "CyberFi ajan motoru"', build);
  binary = replace(binary, 'description: "Happy Agent"', 'description: "CyberFi ajan motoru"', build);
  binary = replace(binary, 'publisher: "Slopus"', 'publisher: "CyberFi"', build);
  changes.push([build, binary]);
  if (platform === 'win32') copyFileSync(join(here, '../windows/CyberFi.ico'), join(native, 'windows/happy.ico'));
  else {
    const status = join(native, 'StatusIcon.swift');
    changes.push([status, brandedStatusIcon(readFileSync(status, 'utf8'), readFileSync(join(here, 'CyberFi-tray.png')))]);
    const main = join(native, 'main.swift');
    changes.push([main, replace(readFileSync(main, 'utf8'), 'import CoreGraphics', 'import CoreGraphics\n\nProcessInfo.processInfo.processName = "CyberFi ajan motoru"', main)]);
    const script = join(root, 'packages/happy-agent-modules/scripts/build-menu-bar.mjs');
    let text = readFileSync(script, 'utf8').replaceAll('\r\n', '\n');
    text = replace(text, '            outfile,\n            ...sources,', '            outfile,\n            "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", join(nativeRoot, "CyberFi-Info.plist"),\n            ...sources,', script);
    text = replace(text, '    console.log(`Created ${outfile}`);', '    const signature = spawnSync("codesign", ["--force", "--sign", "-", "--identifier", "tr.pdrkocum.agent.engine.menu-bar", outfile], { stdio: "inherit" });\n    if (signature.status !== 0) throw new Error("CyberFi native menu ad-hoc signing failed.");\n    console.log(`Created ${outfile}`);', script);
    changes.push([script, text]);
    copyFileSync(join(here, 'CyberFi-Info.plist'), join(native, 'CyberFi-Info.plist'));
  }
  for (const [path, text] of changes) writeFileSync(path, text, 'utf8');
  for (const fixture of ['smoke-command-tools.mjs', 'smoke-mcp-deep.mjs', 'mcp-deep-catalog.json.gz'])
    copyFileSync(join(here, fixture), join(root, 'packages/happy-agent/scripts', fixture));
}

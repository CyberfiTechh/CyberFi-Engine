import { randomUUID } from "node:crypto";
import {
    link,
    mkdir,
    mkdtemp,
    realpath,
    rename,
    rm,
    symlink,
    unlink,
    writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { withAgentConfig } from "@slopus/happy-agent-base";
import {
    createHostCompute,
    NativeProcessManager,
    type ProcessRunResult,
} from "@slopus/happy-agent-compute";
import { createRootContext } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cyberFiCommandToolsEnvironment,
    cyberFiCommandToolsReadiness,
} from "../../sources/compute/cyberfiCommandToolsReady.js";
import { ComputeModule } from "../../sources/compute/index.js";
import { ConfigModule } from "../../sources/config/index.js";
import { SecretsModule } from "../../sources/secrets/index.js";
import { FakeCompute } from "./support/FakeCompute.js";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

async function fixture() {
    const root = await mkdtemp(join(homedir(), "cyberfi-command-ready-"));
    const home = join(root, "home"),
        managed = join(home, ".pdr-kocum-agent"),
        cwd = join(root, "project");
    await mkdir(cwd, { recursive: true });
    await mkdir(home, { recursive: true });
    const config = await ConfigModule.load(join(managed, ".happy"), {
        environment: { HOME: home },
    });
    const agentHome = config.configuration.paths.agentHome;
    await mkdir(agentHome, { recursive: true });
    const statusPath = join(managed, "mcp-runtime", "command-tools.json"),
        generation = randomUUID();
    await mkdir(dirname(statusPath), { recursive: true });
    const target = process.platform + "-" + process.arch;
    const rgDirectory =
        process.platform === "win32"
            ? "ripgrep-15.2.0-x86_64-pc-windows-msvc"
            : process.arch === "arm64"
              ? "ripgrep-15.2.0-aarch64-apple-darwin"
              : "ripgrep-15.2.0-x86_64-apple-darwin";
    const paths = [
        join(managed, "mcp-runtime", "runtimes", "python-" + target, "python"),
        join(managed, "mcp-runtime", "runtimes", "rg-" + target, rgDirectory),
    ];
    const environment = {
        CYBERFI_COMMAND_TOOLS_STATUS_PATH: statusPath,
        CYBERFI_COMMAND_TOOLS_GENERATION: generation,
        HAPPY_AGENT_COMMAND_TOOL_READ_PATHS: JSON.stringify(paths),
    };
    const status = async (state: string) => {
        await writeFile(statusPath + ".tmp", JSON.stringify({ version: 1, generation, state }));
        await rename(statusPath + ".tmp", statusPath);
    };
    const install = async () => {
        const python =
            process.platform === "win32"
                ? join(paths[0]!, "python.exe")
                : join(paths[0]!, "bin", "python3");
        const rg = join(paths[1]!, process.platform === "win32" ? "rg.exe" : "rg");
        for (const file of [python, rg]) {
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, "fixture", { mode: 0o755 });
        }
        await status("ready");
    };
    const close = async () => {
        const canonical = await realpath(root),
            rel = relative(await realpath(homedir()), canonical);
        if (
            !basename(canonical).startsWith("cyberfi-command-ready-") ||
            isAbsolute(rel) ||
            rel === ".." ||
            rel.startsWith(".." + sep)
        )
            throw Error("Refusing cleanup outside owned fixture");
        await rm(canonical, { recursive: true, force: true });
    };
    return {
        root,
        home,
        managed,
        cwd,
        config,
        agentHome,
        statusPath,
        generation,
        paths,
        environment,
        status,
        install,
        close,
    };
}

it("does not inspect paths for an unmanaged daemon", async () => {
    await expect(
        cyberFiCommandToolsReadiness("not an absolute path", {})(),
    ).resolves.toBeUndefined();
});

describe.runIf(process.platform === "win32" || process.platform === "darwin")(
    "managed terminal readiness",
    () => {
        it("executes full access natively without entering the supervisor, while workspace write keeps its supervisor policy", async () => {
            const f = await fixture(),
                ctx = createRootContext().named("native-full-access-readiness");
            const manager = new NativeProcessManager(ctx),
                nativeRun = manager.run.bind(manager);
            const policies: Record<string, unknown>[] = [];
            let module: ComputeModule | undefined;
            try {
                await f.install();
                for (const [key, value] of Object.entries(f.environment)) vi.stubEnv(key, value);
                const starts = vi.spyOn(manager, "start");
                const runCalls = vi
                    .spyOn(manager, "run")
                    .mockImplementation(async (context, options) => {
                        const policyIndex = options.args?.indexOf("--policy") ?? -1;
                        if (policyIndex < 0) return await nativeRun(context, options);
                        // Inspect restricted preparation without changing this machine's sandbox ACLs.
                        policies.push(
                            JSON.parse(options.args![policyIndex + 1]!) as Record<string, unknown>,
                        );
                        return {
                            id: "owned-policy-probe",
                            command: options.command,
                            cwd: options.cwd,
                            status: "exited",
                            pid: null,
                            stdout: "",
                            stderr: "",
                            exitCode: 0,
                            signal: null,
                            timedOut: false,
                            aborted: false,
                            killed: false,
                        } satisfies ProcessRunResult;
                    });
                module = ComputeModule.withProvider(f.config, new SecretsModule(), {
                    id: "host",
                    create: async (_context, options) =>
                        createHostCompute({
                            ctx,
                            ...options,
                            home: f.home,
                            processManager: manager,
                        }),
                });
                const machine = await module.resolve(
                    withAgentConfig(ctx, {
                        modules: { compute: { cwd: f.cwd, providerId: "host" } },
                    }),
                    "native-permission-agent",
                );
                if (!machine) throw Error("Missing compute");
                const command =
                    process.platform === "win32"
                        ? "[Console]::Write('NATIVE_FULL_ACCESS_SENTINEL')"
                        : "printf NATIVE_FULL_ACCESS_SENTINEL";
                const full = await machine.shell.run({
                    command,
                    permissions: {
                        mode: "full_access",
                        network: { egress: true, localBinding: true },
                    },
                    timeoutMs: 15_000,
                });
                expect(full).toMatchObject({
                    exitCode: 0,
                    stdout: "NATIVE_FULL_ACCESS_SENTINEL",
                    timedOut: false,
                });
                expect(policies).toHaveLength(0);
                expect(runCalls.mock.calls[0]?.[1].args?.includes("--policy")).not.toBe(true);
                const nativePath = Object.entries(runCalls.mock.calls[0]?.[1].env ?? {}).filter(
                    ([key]) =>
                        process.platform === "win32"
                            ? key.toLowerCase() === "path"
                            : key === "PATH",
                );
                expect(nativePath).toHaveLength(1);
                const expected = await Promise.all(f.paths.map((path) => realpath(path)));
                expect(nativePath[0]?.[1]?.split(delimiter).slice(0, 2)).toEqual([
                    process.platform === "win32" ? expected[0] : join(expected[0]!, "bin"),
                    expected[1],
                ]);
                const session = await machine.shell.startSession({
                    command,
                    permissions: {
                        mode: "full_access",
                        network: { egress: true, localBinding: true },
                    },
                });
                await vi.waitFor(
                    async () =>
                        expect(
                            await machine.shell.readSession(session, { peek: true }),
                        ).toMatchObject({
                            status: "completed",
                            exitCode: 0,
                            stdout: "NATIVE_FULL_ACCESS_SENTINEL",
                        }),
                    { timeout: 15_000 },
                );
                expect(starts.mock.calls).toHaveLength(2);
                expect(
                    starts.mock.calls.every(([, option]) => !option.args?.includes("--policy")),
                ).toBe(true);
                expect(policies).toHaveLength(0);
                await machine.shell.run({
                    command,
                    permissions: {
                        mode: "workspace_write",
                        network: { egress: false, localBinding: false },
                    },
                });
                expect(policies).toHaveLength(1);
                expect(policies[0]?.mode).toBe("workspace_write");
                expect(policies[0]?.deniedWritePaths).toContain(
                    join(await realpath(f.cwd), ".git"),
                );
            } finally {
                await module?.dispose(ctx);
                await manager.killAll(ctx, { includeDetached: true });
                await f.close();
            }
        });

        it.each(["new-daemon", "adopted-daemon"])(
            "%s waits only for terminal starts and refreshes narrow read roots after a compute already exists",
            async (mode) => {
                const f = await fixture(),
                    ctx = createRootContext().named("command-readiness");
                let module: ComputeModule | undefined;
                try {
                    await f.status("preparing");
                    for (const [key, value] of Object.entries(f.environment))
                        vi.stubEnv(key, mode === "new-daemon" ? value : undefined);
                    const fake = new FakeCompute(f.cwd);
                    fake.write(join(f.cwd, "README.md"), "Existing project");
                    for (const command of ["fixture", "fixture-session", "full fixture"])
                        fake.commands.set(command, {});
                    const runCalls = vi.spyOn(fake.shell, "run");
                    module = ComputeModule.withProvider(f.config, new SecretsModule(), {
                        id: "host",
                        create: async () => fake,
                    });
                    const machine = await module.resolve(
                        withAgentConfig(ctx, {
                            modules: { compute: { cwd: f.cwd, providerId: "host" } },
                        }),
                        "ready-agent",
                    );
                    if (!machine) throw Error("Missing compute");
                    const permission = {
                        mode: "read_only" as const,
                        network: { egress: false, localBinding: false },
                        deniedWritePaths: [join(f.cwd, ".git")],
                    };
                    let done = false;
                    const run = machine.shell
                        .run({ command: "fixture", permissions: permission })
                        .finally(() => {
                            done = true;
                        });
                    const session = machine.shell.startSession({
                        command: "fixture-session",
                        permissions: permission,
                    });
                    expect(await machine.fs.readFile(permission, join(f.cwd, "README.md"))).toBe(
                        "Existing project",
                    );
                    expect(fake.startedOptions).toHaveLength(0);
                    expect(runCalls).not.toHaveBeenCalled();
                    expect(done).toBe(false);
                    await f.install();
                    await Promise.all([run, session]);
                    expect(fake.startedOptions).toHaveLength(1);
                    expect(runCalls).toHaveBeenCalledTimes(1);
                    const expected = await Promise.all(f.paths.map((path) => realpath(path)));
                    for (const option of [runCalls.mock.calls[0]![0], ...fake.startedOptions]) {
                        expect(option.permissions.allowedReadPaths).toEqual(expected);
                        expect(option.permissions.deniedWritePaths).toEqual(
                            permission.deniedWritePaths,
                        );
                        expect(option.permissions.allowedWritePaths).toBeUndefined();
                        expect(option.permissions.allowedReadPaths).not.toContain(
                            await realpath(f.home),
                        );
                        const pathKey = Object.keys(option.environment ?? {}).find((key) =>
                            process.platform === "win32"
                                ? key.toLowerCase() === "path" && option.environment?.[key] !== null
                                : key === "PATH",
                        );
                        expect(
                            option.environment?.[pathKey!]?.split(delimiter).slice(0, 2),
                        ).toEqual([
                            process.platform === "win32" ? expected[0] : join(expected[0]!, "bin"),
                            expected[1],
                        ]);
                    }
                    await machine.shell.run({
                        command: "full fixture",
                        permissions: {
                            mode: "full_access",
                            network: { egress: true, localBinding: true },
                        },
                    });
                    expect(
                        runCalls.mock.calls.at(-1)?.[0].permissions.allowedReadPaths,
                    ).toBeUndefined();
                } finally {
                    await module?.dispose(ctx);
                    await f.close();
                }
            },
        );

        it("adopts a later receipt, follows valid rotation and recovers from a corrupt receipt", async () => {
            const f = await fixture();
            try {
                const ready = cyberFiCommandToolsReadiness(f.agentHome, {});
                await expect(ready()).resolves.toBeUndefined();
                await f.install();
                await expect(ready()).resolves.toEqual(
                    await Promise.all(f.paths.map((path) => realpath(path))),
                );
                await writeFile(
                    f.statusPath + ".tmp",
                    JSON.stringify({ version: 1, generation: randomUUID(), state: "ready" }),
                );
                await rename(f.statusPath + ".tmp", f.statusPath);
                await expect(
                    cyberFiCommandToolsReadiness(f.agentHome, f.environment)(),
                ).resolves.toHaveLength(2);
                await writeFile(f.statusPath, "{");
                await expect(ready()).rejects.toThrow(/doğrulanamadı/u);
                await f.status("ready");
                await expect(ready()).resolves.toHaveLength(2);
                await unlink(f.statusPath);
                const controller = new AbortController(),
                    pending = ready(controller.signal);
                controller.abort();
                await expect(pending).rejects.toMatchObject({ name: "AbortError" });
                await f.status("ready");
                await expect(ready()).resolves.toHaveLength(2);
            } finally {
                await f.close();
            }
        });

        it.each(["missing-path", "missing-generation"])(
            "rejects an incoherent managed environment: %s",
            async (kind) => {
                const f = await fixture();
                try {
                    await f.install();
                    const env = { ...f.environment } as NodeJS.ProcessEnv;
                    delete env[
                        kind === "missing-path"
                            ? "CYBERFI_COMMAND_TOOLS_STATUS_PATH"
                            : "CYBERFI_COMMAND_TOOLS_GENERATION"
                    ];
                    await expect(cyberFiCommandToolsReadiness(f.agentHome, env)()).rejects.toThrow(
                        /doğrulanamadı/u,
                    );
                } finally {
                    await f.close();
                }
            },
        );

        it("prefixes only managed tools and preserves other environment and explicit PATH removal", () => {
            const paths =
                process.platform === "win32"
                    ? ["C:\\owned\\python", "C:\\owned\\rg"]
                    : ["/owned/python", "/owned/rg"];
            const base = { PATH: "original", KEEP: "base" },
                command = { KEEP: "command", SECRET: "untouched" };
            const changed = cyberFiCommandToolsEnvironment(paths, base, command);
            expect(changed).toMatchObject(command);
            expect(changed.PATH).toBe(
                [
                    process.platform === "win32" ? paths[0] : join(paths[0]!, "bin"),
                    paths[1],
                    "original",
                ].join(delimiter),
            );
            expect(base).toEqual({ PATH: "original", KEEP: "base" });
            expect(command).toEqual({ KEEP: "command", SECRET: "untouched" });
            expect(cyberFiCommandToolsEnvironment(paths, base, { PATH: null })).toEqual({
                PATH: null,
            });
        });

        it.runIf(process.platform === "win32")("normalizes inherited Windows PATH aliases", () => {
            const base = { Path: "old-path", PATH: "active-path" },
                command = { path: "command-path", KEEP: "unchanged" };
            const result = cyberFiCommandToolsEnvironment(["C:\\python", "C:\\rg"], base, command);
            const merged: Record<string, string | null> = { ...base };
            for (const [key, value] of Object.entries(result)) {
                if (value === null) delete merged[key];
                else merged[key] = value;
            }
            expect(Object.keys(merged).filter((key) => key.toLowerCase() === "path")).toEqual([
                "path",
            ]);
            expect(merged.path).toBe("C:\\python;C:\\rg;command-path");
            expect(merged.KEEP).toBe("unchanged");
            expect(() =>
                cyberFiCommandToolsEnvironment(["C:\\python", "C:\\rg"], base, {
                    PATH: "one",
                    Path: "two",
                }),
            ).toThrow(/doğrulanamadı/u);
        });

        it("aborts a waiting start without launching a command", async () => {
            const f = await fixture();
            try {
                await f.status("preparing");
                const controller = new AbortController();
                const waiting = cyberFiCommandToolsReadiness(
                    f.agentHome,
                    f.environment,
                )(controller.signal);
                controller.abort();
                await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
            } finally {
                await f.close();
            }
        });

        it("bounds a missing installation by five minutes", async () => {
            const f = await fixture();
            try {
                await f.status("preparing");
                const now = performance.now();
                const waiting = cyberFiCommandToolsReadiness(f.agentHome, f.environment)();
                vi.spyOn(performance, "now").mockReturnValue(now + 5 * 60_000 + 1);
                await expect(waiting).rejects.toThrow(/zaman aşımına/u);
            } finally {
                await f.close();
            }
        });

        it("cancels a start-session wait when its compute closes", async () => {
            const f = await fixture(),
                ctx = createRootContext().named("closing-command-readiness");
            let module: ComputeModule | undefined;
            try {
                await f.status("preparing");
                for (const [key, value] of Object.entries(f.environment)) vi.stubEnv(key, value);
                const fake = new FakeCompute(f.cwd);
                fake.commands.set("must-not-start", {});
                module = ComputeModule.withProvider(f.config, new SecretsModule(), {
                    id: "host",
                    create: async () => fake,
                });
                const machine = await module.resolve(
                    withAgentConfig(ctx, {
                        modules: { compute: { cwd: f.cwd, providerId: "host" } },
                    }),
                    "closing-agent",
                );
                if (!machine) throw Error("Missing compute");
                const waiting = machine.shell.startSession({
                    command: "must-not-start",
                    permissions: {
                        mode: "read_only",
                        network: { egress: false, localBinding: false },
                    },
                });
                const checked = expect(waiting).rejects.toMatchObject({ name: "AbortError" });
                await module.dispose(ctx);
                await checked;
                expect(fake.startedOptions).toHaveLength(0);
            } finally {
                await module?.dispose(ctx);
                await f.close();
            }
        });

        it("reports failed installation without running an incomplete tool", async () => {
            const f = await fixture();
            try {
                await f.status("failed");
                await expect(
                    cyberFiCommandToolsReadiness(f.agentHome, f.environment)(),
                ).rejects.toThrow(/hazırlanamadı/u);
            } finally {
                await f.close();
            }
        });

        it.each([
            "malformed",
            "oversized",
            "invalid-generation",
            "unknown-field",
            "missing-runtime",
            "wrong-runtime",
            "outside-status",
            "hard-linked-status",
        ])("rejects %s", async (kind) => {
            const f = await fixture();
            try {
                await f.install();
                const env: NodeJS.ProcessEnv = { ...f.environment };
                if (kind === "malformed") await writeFile(f.statusPath, "{");
                if (kind === "oversized") await writeFile(f.statusPath, " ".repeat(2049));
                if (kind === "invalid-generation")
                    env.CYBERFI_COMMAND_TOOLS_GENERATION = "not-a-generation";
                if (kind === "unknown-field")
                    await writeFile(
                        f.statusPath,
                        JSON.stringify({
                            version: 1,
                            generation: f.generation,
                            state: "ready",
                            extra: "NO",
                        }),
                    );
                if (kind === "missing-runtime") await rm(f.paths[1]!, { recursive: true });
                if (kind === "wrong-runtime")
                    env.HAPPY_AGENT_COMMAND_TOOL_READ_PATHS = JSON.stringify([f.paths[0], f.home]);
                if (kind === "outside-status")
                    env.CYBERFI_COMMAND_TOOLS_STATUS_PATH = join(f.home, "command-tools.json");
                if (kind === "hard-linked-status")
                    await link(f.statusPath, join(f.root, "linked.json"));
                await expect(cyberFiCommandToolsReadiness(f.agentHome, env)()).rejects.toThrow(
                    /doğrulanamadı/u,
                );
            } finally {
                await f.close();
            }
        });

        it("rejects a redirected status ancestor", async () => {
            const f = await fixture();
            const moved = join(f.managed, "moved-runtime");
            try {
                await f.install();
                await rename(dirname(f.statusPath), moved);
                await symlink(
                    moved,
                    dirname(f.statusPath),
                    process.platform === "win32" ? "junction" : "dir",
                );
                await expect(
                    cyberFiCommandToolsReadiness(f.agentHome, f.environment)(),
                ).rejects.toThrow(/doğrulanamadı/u);
            } finally {
                await unlink(dirname(f.statusPath));
                await f.close();
            }
        });
    },
);

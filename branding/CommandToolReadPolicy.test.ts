import { mkdir, mkdtemp, readFile, realpath, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { withAgentConfig, withAgentPermissionMode } from "@slopus/happy-agent-base";
import { createHostCompute } from "@slopus/happy-agent-compute";
import { createRootContext } from "@steve.kite/stdlib";
import { expect, it, vi } from "vitest";
import { ComputeModule } from "../../sources/compute/index.js";
import { ConfigModule } from "../../sources/config/index.js";
import { SecretsModule } from "../../sources/secrets/index.js";
import { delegatedPermissionMode } from "../../sources/impl/delegatedPermissionMode.js";

it.runIf(process.platform === "win32" || process.platform === "darwin")(
    "keeps managed command runtimes readable without granting writes, home or agent credentials",
    async () => {
        const root = await mkdtemp(join(homedir(), "cyberfi-command-policy-"));
        const home = join(root, "home"),
            managed = join(home, ".pdr-kocum-agent"),
            cwd = join(root, "workspace");
        const ctx = createRootContext().named("cyberfi-command-read-policy");
        let compute: ComputeModule | undefined;
        try {
            await mkdir(cwd, { recursive: true });
            await mkdir(home, { recursive: true });
            const config = await ConfigModule.load(join(managed, ".happy"), {
                environment: { HOME: home },
            });
            const target = process.platform + "-" + process.arch;
            const rgDirectory =
                process.platform === "win32"
                    ? "ripgrep-15.2.0-x86_64-pc-windows-msvc"
                    : process.arch === "arm64"
                      ? "ripgrep-15.2.0-aarch64-apple-darwin"
                      : "ripgrep-15.2.0-x86_64-apple-darwin";
            const base = join(managed, "mcp-runtime", "runtimes");
            const paths = [
                join(base, "python-" + target, "python"),
                join(base, "rg-" + target, rgDirectory),
            ];
            for (const path of paths) {
                await mkdir(path, { recursive: true });
                await writeFile(join(path, "runtime-sentinel.txt"), "RUNTIME");
            }
            const privateFile = join(config.configuration.paths.agentHome, "token");
            await mkdir(dirname(privateFile), { recursive: true });
            await writeFile(privateFile, "PRIVATE");
            await writeFile(join(home, "private-note.txt"), "HOME_PRIVATE");
            vi.stubEnv("HAPPY_AGENT_COMMAND_TOOL_READ_PATHS", JSON.stringify(paths));
            compute = ComputeModule.withProvider(config, new SecretsModule(), {
                id: "host",
                create: async (_ctx, options) =>
                    createHostCompute({ ctx, ...options, home, platform: "win32" }),
            });
            vi.spyOn(compute, "fileSystemIdentity").mockReturnValue("isolated-native");
            const childMode = delegatedPermissionMode("workspace_write", { read_only: true });
            expect(childMode).toBe("read_only");
            for (const mode of ["workspace_write", childMode] as const) {
                const scoped = withAgentConfig(withAgentPermissionMode(ctx, mode), {
                    modules: { compute: { cwd, providerId: "host" } },
                });
                const machine = await compute.resolve(scoped, mode);
                if (!machine) throw Error("Missing native compute");
                const permission = compute.permissionsForContext(scoped);
                for (const path of paths) {
                    expect(
                        await machine.fs.readFile(permission, join(path, "runtime-sentinel.txt")),
                    ).toBe("RUNTIME");
                    await expect(
                        machine.fs.writeFile(permission, join(path, "write.txt"), "NO"),
                    ).rejects.toThrow();
                }
                await expect(machine.fs.readFile(permission, privateFile)).rejects.toThrow(
                    /denied path/,
                );
                await expect(
                    machine.fs.readFile(permission, join(home, "private-note.txt")),
                ).rejects.toThrow(/Restricted permissions/);
                if (mode === "read_only")
                    await expect(
                        machine.fs.writeFile(permission, join(cwd, "child-write.txt"), "NO"),
                    ).rejects.toThrow(/read-only/);
            }
            expect(compute.hostPolicy.readableDirectories).toEqual(
                expect.arrayContaining(await Promise.all(paths.map((path) => realpath(path)))),
            );
            expect(await readFile(privateFile, "utf8")).toBe("PRIVATE");
            const pythonRoot = await realpath(paths[0]!);
            const rgRoot = await realpath(paths[1]!);
            await unlink(join(paths[1]!, "runtime-sentinel.txt"));
            await rmdir(paths[1]!);
            expect(compute.hostPolicy.readableDirectories).toContain(pythonRoot);
            expect(compute.hostPolicy.readableDirectories).not.toContain(rgRoot);
            const partialContext = withAgentConfig(withAgentPermissionMode(ctx, "read_only"), {
                modules: { compute: { cwd, providerId: "host" } },
            });
            const partialMachine = await compute.resolve(partialContext, "partial-install");
            if (!partialMachine) throw Error("Missing partial-install compute");
            const partialPermission = compute.permissionsForContext(partialContext);
            expect(
                await partialMachine.fs.readFile(
                    partialPermission,
                    join(paths[0]!, "runtime-sentinel.txt"),
                ),
            ).toBe("RUNTIME");
            await expect(
                partialMachine.fs.writeFile(partialPermission, join(paths[0]!, "write.txt"), "NO"),
            ).rejects.toThrow();
            await expect(
                partialMachine.fs.readFile(partialPermission, privateFile),
            ).rejects.toThrow(/denied path/);
            vi.stubEnv(
                "HAPPY_AGENT_COMMAND_TOOL_READ_PATHS",
                JSON.stringify([home, dirname(privateFile)]),
            );
            expect(compute.hostPolicy.readableDirectories).not.toContain(await realpath(home));
            expect(compute.hostPolicy.readableDirectories).not.toContain(
                await realpath(dirname(privateFile)),
            );
            expect(compute.hostPolicy.readableDirectories).not.toContain(pythonRoot);
        } finally {
            await compute?.dispose(ctx);
            vi.unstubAllEnvs();
            vi.restoreAllMocks();
            const fromHome = relative(await realpath(homedir()), await realpath(root));
            if (
                fromHome === "" ||
                fromHome === ".." ||
                isAbsolute(fromHome) ||
                fromHome.startsWith(".." + sep) ||
                !basename(root).startsWith("cyberfi-command-policy-")
            )
                throw Error("Unsafe test cleanup path");
            await rm(root, { recursive: true, force: true });
        }
    },
);

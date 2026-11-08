import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import { withAgentConfig, withAgentPermissionMode } from "@slopus/happy-agent-base";
import { createHostCompute } from "@slopus/happy-agent-compute";
import { createRootContext } from "@steve.kite/stdlib";
import { expect, it, vi } from "vitest";
import { ComputeModule } from "../../sources/compute/index.js";
import { ConfigModule } from "../../sources/config/index.js";
import { SecretsModule } from "../../sources/secrets/index.js";
import { SkillsModule } from "../../sources/skills/index.js";
import { delegatedPermissionMode } from "../../sources/impl/delegatedPermissionMode.js";

it("lets restricted parents and read-only children read installed skills and support files without opening home or writes", async () => {
    const root = await mkdtemp(join(homedir(), "cyberfi-skill-policy-"));
    const home = join(root, "home");
    const cwd = join(root, "workspace");
    const extra = join(home, "installed-references");
    const linked = join(home, "linked-skills");
    const homeAlias = join(home, "alias-home");
    const ancestorAlias = join(home, "alias-ancestor");
    const volumeAlias = join(home, "alias-volume");
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(home, { recursive: true });
    const initial = await ConfigModule.load(join(home, ".happy"), { environment: { HOME: home } });
    const globalConfig = initial.configuration.paths.globalConfigPath;
    await mkdir(dirname(globalConfig), { recursive: true });
    await writeFile(globalConfig, `[skills]\ndirectories = ${JSON.stringify([extra, home, linked, homeAlias])}\n`);
    const config = await ConfigModule.load(join(home, ".happy"), { environment: { HOME: home } });
    const ctx = createRootContext().named("cyberfi-installed-skills-policy");
    const compute = ComputeModule.withProvider(config, new SecretsModule(), {
        id: "host",
        create: async (_ctx, options) => createHostCompute({ ctx, ...options, home, platform: "win32" }),
    });
    // Only the native identity is adapted; discovery and filesystem permission checks are real.
    vi.spyOn(compute, "fileSystemIdentity").mockReturnValue("isolated-native");
    const skills = new SkillsModule(compute, undefined, config);
    const installed = join(config.globalSkillsRoot, "role-review");
    const extraSkill = join(extra, "extra-review");
    const content = "---\nname: role-review\ndescription: Installed role.\n---\nREAD_THE_SUPPORT_FILE";
    await mkdir(installed, { recursive: true });
    await mkdir(extraSkill, { recursive: true });
    const builtin = config.configuration.paths.skillsHome;
    await mkdir(join(builtin, "builtin-review"), { recursive: true });
    await writeFile(join(builtin, "builtin-review", "SKILL.md"), "---\nname: builtin-review\ndescription: Builtin role.\n---\nBUILTIN");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(extra, linked, linkType);
    await symlink(home, homeAlias, linkType);
    await symlink(root, ancestorAlias, linkType);
    await symlink(parse(home).root, volumeAlias, linkType);
    await writeFile(join(installed, "SKILL.md"), content);
    await writeFile(join(installed, "support.md"), "OWNED_SUPPORT");
    await writeFile(join(extraSkill, "SKILL.md"), "---\nname: extra-review\ndescription: Extra role.\n---\nEXTRA");
    await writeFile(join(home, "private-note.txt"), "PRIVATE_SENTINEL");
    await mkdir(join(home, ".ssh"));
    await writeFile(join(home, ".ssh", "auth-sentinel"), "AUTH_SENTINEL");
    const privateFile = join(config.configuration.paths.agentHome, "credential-sentinel.txt");
    await mkdir(dirname(privateFile), { recursive: true });
    await writeFile(privateFile, "CREDENTIAL_SENTINEL");
    try {
        const opened = [];
        const childMode = delegatedPermissionMode("workspace_write", { read_only: true });
        expect(childMode).toBe("read_only");
        for (const [id, mode] of [["parent", "workspace_write"], ["child", childMode]] as const) {
            const scoped = withAgentConfig(withAgentPermissionMode(ctx, mode), { modules: { compute: { cwd, providerId: "host" } } });
            const machine = await compute.resolve(scoped, id);
            if (!machine) throw Error("Missing native compute");
            const permission = compute.permissionsForContext(scoped);
            opened.push({ machine, permission });
            expect((await skills.list(scoped, id)).skills.map(s => s.name)).toEqual(expect.arrayContaining(["role-review", "extra-review"]));
            expect(await skills.read(scoped, id, { name: "role-review" })).toMatchObject({ content });
            expect(await machine.fs.readFile(permission, join(installed, "support.md"))).toBe("OWNED_SUPPORT");
            await expect(machine.fs.readFile(permission, join(home, "private-note.txt"))).rejects.toThrow(/Restricted permissions/);
            await expect(machine.fs.readFile(permission, privateFile)).rejects.toThrow(/denied path/);
            await expect(machine.fs.readFile(permission, join(home, ".ssh", "auth-sentinel"))).rejects.toThrow(/Restricted permissions/);
            await expect(machine.fs.readFile(permission, join(homeAlias, "private-note.txt"))).rejects.toThrow(/Restricted permissions/);
            expect(await machine.fs.readFile(permission, join(linked, "extra-review", "SKILL.md"))).toContain("EXTRA");
            await expect(machine.fs.writeFile(permission, join(installed, "support.md"), "CHANGED")).rejects.toThrow();
            await expect(machine.fs.writeFile(permission, join(home, "private-note.txt"), "CHANGED")).rejects.toThrow();
            if (mode === "read_only") await expect(machine.fs.writeFile(permission, join(cwd, "child-write.txt"), "CHANGED")).rejects.toThrow(/read-only/);
            const escape = join(installed, "escape");
            if (id === "parent") await symlink(home, escape, process.platform === "win32" ? "junction" : "dir");
            await expect(machine.fs.readFile(permission, join(escape, "private-note.txt"))).rejects.toThrow(/Restricted permissions/);
            const denied = { ...permission, deniedReadPaths: [installed] };
            await expect(machine.fs.readFile(denied, join(installed, "support.md"))).rejects.toThrow(/denied path/);
        }
        expect(await readFile(join(installed, "support.md"), "utf8")).toBe("OWNED_SUPPORT");
        expect(await readFile(join(home, "private-note.txt"), "utf8")).toBe("PRIVATE_SENTINEL");
        expect(compute.hostPolicy.readableDirectories).toEqual(expect.arrayContaining([
            config.globalSkillsRoot, extra, config.configuration.paths.skillsHome,
        ]));
        expect(compute.hostPolicy.readableDirectories).not.toContain(home);
        expect(config.globalSkillDirectories).toContain(home);
        expect(compute.hostPolicy.readableDirectories).not.toContain(linked);
        expect(compute.hostPolicy.readableDirectories).not.toContain(homeAlias);
        expect(compute.hostPolicy.readableDirectories).toContain(await realpath(extra));
        await unlink(linked);
        await symlink(home, linked, linkType);
        for (const { machine, permission } of opened) {
            await expect(machine.fs.readFile(permission, join(linked, "private-note.txt"))).rejects.toThrow(/Restricted permissions/);
        }
        const globalRoot = vi.spyOn(config, "globalSkillsRoot", "get").mockReturnValue(homeAlias);
        expect(compute.hostPolicy.readableDirectories).not.toContain(await realpath(home));
        globalRoot.mockRestore();
        // Test broad roots as policy inputs without asking discovery to scan a filesystem root.
        vi.spyOn(config, "globalSkillDirectories", "get").mockReturnValue([extra, home, root, homeAlias, ancestorAlias, volumeAlias, privateFile, join(home, ".ssh", "auth-sentinel"), join(home, "missing-skills"), parse(home).root, ...(process.platform === "win32" ? ["Z:\\"] : [])]);
        expect(compute.hostPolicy.readableDirectories).toEqual([
            await realpath(config.globalSkillsRoot), await realpath(extra), await realpath(config.configuration.paths.skillsHome),
        ]);
        const resolveSkillDirectory = config.resolveSkillDirectory.bind(config);
        vi.spyOn(config, "resolveSkillDirectory").mockImplementation(path => path === "~" ? homeAlias : resolveSkillDirectory(path));
        expect(compute.hostPolicy.readableDirectories).toEqual([
            await realpath(config.globalSkillsRoot), await realpath(extra), await realpath(config.configuration.paths.skillsHome),
        ]);
    } finally {
        await compute.dispose(ctx);
        vi.restoreAllMocks();
        const target = resolve(root);
        if (!target.startsWith(resolve(homedir()) + sep) || !target.includes("cyberfi-skill-policy-")) throw Error("Unsafe test cleanup path");
        await rm(target, { recursive: true, force: true });
    }
});

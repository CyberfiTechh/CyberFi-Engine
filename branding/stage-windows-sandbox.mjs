import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    constants, copyFileSync, lstatSync, mkdtempSync, readdirSync, readFileSync,
    realpathSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

assert(process.platform === "win32" && process.arch === "x64");
assert(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted",
    "Sandbox build staging is limited to disposable hosted Windows CI.");
const root = realpathSync(".");
const native = join(root, "packages/happy-agent-supervisor/native");
const binaries = ["happy-agent-supervisor.exe", "happy-sandbox-runner.exe", "happy-sandbox-setup.exe"];
const nativeOutput = join(native, "target/release");
const vendor = "vendor/x86_64-pc-windows-gnu/bin";
const agent = createRequire(join(root, "packages/happy-agent/package.json"));
const compute = createRequire(agent.resolve("@slopus/happy-agent-compute"));
const installed = realpathSync(join(dirname(compute.resolve("@slopus/happy-agent-supervisor-win32-x64/package.json")), vendor));
assert(relative(root, installed).startsWith("node_modules" + sep), "Sandbox package resolved outside the repository dependency tree.");
const sha256 = value => createHash("sha256").update(value).digest("hex");
function hashFile(path) {
    assert(lstatSync(path).isFile(), "Expected a regular sandbox executable.");
    return sha256(readFileSync(path));
}
const expected = Object.fromEntries(binaries.map(name => [name, hashFile(join(nativeOutput, name))]));
const operation = process.argv[2];
if (operation === "stage") {
    const { assertWindowsSystemImports } = await import(pathToFileURL(join(root, "packages/happy-agent/scripts/assertWindowsSystemImports.mjs")));
    for (const name of binaries) {
        assertWindowsSystemImports(join(nativeOutput, name));
        assert(lstatSync(join(installed, name)).isFile(), "Installed sandbox executable is not a regular file.");
    }
    for (const name of binaries) {
        const destination = join(installed, name);
        // Detach the pnpm store hardlink before copying the rebuilt executable.
        unlinkSync(destination);
        copyFileSync(join(nativeOutput, name), destination, constants.COPYFILE_EXCL);
    }
} else {
    assert.equal(operation, "verify", "Expected stage or verify.");
}
for (const name of binaries) assert.equal(hashFile(join(installed, name)), expected[name], "Staged sandbox hash mismatch: " + name);
if (operation === "verify") {
    const localAppData = mkdtempSync(join(resolve(process.env.RUNNER_TEMP), "cyberfi-embedded-"));
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
        if (["localappdata", "happy_windows_sandbox_home", "happy_windows_sandbox_no_provision"].includes(key.toLowerCase())) delete environment[key];
    }
    const binary = join(root, "packages/happy-agent/dist/bin/happy-agent-win32-x64.exe");
    const metadata = JSON.parse(readFileSync(join(native, "windows/source.json"), "utf8"));
    const status = JSON.parse(execFileSync(binary, ["sandbox", "status", "--json"], {
        encoding: "utf8", windowsHide: true, timeout: 30000,
        env: { ...environment, LOCALAPPDATA: localAppData, HAPPY_WINDOWS_SANDBOX_HOME: join(localAppData, "sandbox-state"), HAPPY_WINDOWS_SANDBOX_NO_PROVISION: "1" },
    }));
    assert.deepEqual(status, { status: "required", setupVersion: metadata.setupVersion });
    const cache = join(localAppData, "HappyAgentRuntime/binary-assets");
    const groups = readdirSync(cache).filter(name => /^supervisor-win32-x64-[a-f0-9]{24}$/u.test(name));
    assert.equal(groups.length, 1, "Expected one freshly materialized Windows sandbox group.");
    const embedded = join(cache, groups[0], vendor);
    for (const name of binaries) assert.equal(hashFile(join(embedded, name)), expected[name], "Embedded sandbox hash mismatch: " + name);
    const proof = {
        sourceCommit: metadata.commit,
        toolchain: metadata.buildToolchain,
        patchSha256: sha256(readFileSync(new URL("./windows-managed-command-tools.patch", import.meta.url))),
        embeddedSha256: expected,
    };
    writeFileSync(join(root, "cyberfi-windows-sandbox-proof.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(proof));
}

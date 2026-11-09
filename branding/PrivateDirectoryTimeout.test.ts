import { execFile } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";

import { ensurePrivateDirectory } from "../../sources/host/localAgentPaths.js";

vi.mock("node:fs/promises", () => ({ chmod: vi.fn(), mkdir: vi.fn() }));
vi.mock("node:child_process", () => ({
    execFile: vi.fn((
        _file: string,
        _args: readonly string[],
        options: { timeout: number },
        callback: (error: Error | null) => void,
    ) => {
        const simulatedAclMs = 23_000;
        setTimeout(() => {
            callback(options.timeout < simulatedAclMs ? new Error("PowerShell ACL command timed out") : null);
        }, Math.min(simulatedAclMs, options.timeout));
    }),
}));

afterEach(() => vi.useRealTimers());

it.skipIf(process.platform !== "win32")("accepts a slow ACL initializer without weakening Windows ACL", async () => {
    vi.useFakeTimers();
    const path = "C:\\Users\\Synthetic\\CyberFi\\agent";
    const completed = expect(ensurePrivateDirectory(path)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(23_000);
    await completed;
    expect(execFile).toHaveBeenCalledOnce();
    expect(execFile).toHaveBeenCalledWith(
        expect.stringMatching(/\\System32\\WindowsPowerShell\\v1[.]0\\powershell[.]exe$/iu),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", expect.any(String)],
        expect.objectContaining({
            env: expect.objectContaining({ HAPPY_PRIVATE_DIRECTORY: path }),
            timeout: 60_000,
            maxBuffer: 16_384,
        }),
        expect.any(Function),
    );
    const args = vi.mocked(execFile).mock.calls[0]?.[1];
    if (!Array.isArray(args)) throw new Error("Expected the native PowerShell argument list");
    const script = Buffer.from(args[4]!, "base64").toString("utf16le");
    expect(script).toContain("$acl.SetAccessRuleProtection($true, $false)");
    expect(script).toContain("$target.SetAccessControl($acl)");
});

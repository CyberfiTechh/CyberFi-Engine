import {
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    openSync,
    readSync,
    realpathSync,
    statSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
    cyberFiCommandToolExpectedPaths,
    cyberFiCommandToolReadDirectories,
} from "./cyberfiCommandToolReadPolicy.js";

const INVALID = "Komut araçlarının hazırlık kaydı doğrulanamadı. CyberFi’yi yeniden açın.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function statusRead(agentHome: string, path: string): string | undefined {
    const managed = dirname(dirname(agentHome));
    const canonical = realpathSync(managed);
    for (const candidate of [join(managed, "mcp-runtime"), path]) {
        let info;
        try {
            info = lstatSync(candidate);
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
                return undefined;
            throw new Error(INVALID);
        }
        if (
            info.isSymbolicLink() ||
            (candidate === path ? !info.isFile() : !info.isDirectory()) ||
            relative(join(canonical, relative(managed, candidate)), realpathSync(candidate)) !== ""
        )
            throw new Error(INVALID);
    }
    const fd = openSync(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.nlink !== 1 || info.size > 2048) throw new Error(INVALID);
        const buffer = Buffer.alloc(2049);
        const count = readSync(fd, buffer, 0, buffer.length, 0);
        const content = buffer.subarray(0, count).toString("utf8");
        const after = lstatSync(path);
        if (
            count > 2048 ||
            after.size > 2048 ||
            !after.isFile() ||
            after.isSymbolicLink() ||
            after.nlink !== 1 ||
            relative(join(canonical, "mcp-runtime", "command-tools.json"), realpathSync(path)) !==
                ""
        )
            throw new Error(INVALID);
        // The desktop atomically replaces this record when installation finishes.
        if (after.ino !== info.ino || after.dev !== info.dev) return undefined;
        const value: unknown = JSON.parse(content);
        if (value === null || typeof value !== "object" || Array.isArray(value))
            throw new Error(INVALID);
        const status = value as Record<string, unknown>;
        if (
            Object.keys(status).sort().join(",") !== "generation,state,version" ||
            status.version !== 1 ||
            typeof status.generation !== "string" ||
            !UUID.test(status.generation) ||
            typeof status.state !== "string" ||
            !["preparing", "ready", "failed"].includes(status.state)
        )
            throw new Error(INVALID);
        return status.state as string;
    } finally {
        closeSync(fd);
    }
}

/** Only terminal starts wait; a daemon remembers activation if the receipt is later lost. */
export function cyberFiCommandToolsReadiness(
    agentHome: string,
    environment: NodeJS.ProcessEnv,
): (signal?: AbortSignal, active?: () => boolean) => Promise<string[] | undefined> {
    const configuredPath = environment.CYBERFI_COMMAND_TOOLS_STATUS_PATH;
    const generation = environment.CYBERFI_COMMAND_TOOLS_GENERATION;
    const expected = cyberFiCommandToolExpectedPaths(agentHome);
    const path = join(dirname(dirname(agentHome)), "mcp-runtime", "command-tools.json");
    let managed = configuredPath !== undefined || generation !== undefined;
    return async (signal, active) => {
        if (expected.length !== 2) {
            if (managed) throw new Error(INVALID);
            return undefined;
        }
        if (
            (configuredPath === undefined) !== (generation === undefined) ||
            (configuredPath !== undefined &&
                (!isAbsolute(configuredPath) || relative(path, configuredPath) !== "")) ||
            (generation !== undefined && !UUID.test(generation))
        )
            throw new Error(INVALID);
        if (!managed) {
            try {
                lstatSync(path);
            } catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT")
                    return undefined;
                throw new Error(INVALID);
            }
            managed = true;
        }
        const deadline = performance.now() + 5 * 60_000;
        while (true) {
            signal?.throwIfAborted();
            if (active?.() === false)
                throw new DOMException("Komut başlatma iptal edildi.", "AbortError");
            let state: string | undefined;
            try {
                // The daemon can outlive a window; trust valid rotation at this fixed owned receipt.
                state = statusRead(agentHome, path);
            } catch {
                throw new Error(INVALID);
            }
            if (state === "failed")
                throw new Error(
                    "Python ve dosya arama aracı hazırlanamadı. İnternet bağlantınızı kontrol edip CyberFi’yi yeniden açın.",
                );
            if (state === "ready") {
                const paths = cyberFiCommandToolReadDirectories(
                    agentHome,
                    environment.HAPPY_AGENT_COMMAND_TOOL_READ_PATHS ?? JSON.stringify(expected),
                );
                if (paths.length !== 2) throw new Error(INVALID);
                const python =
                    process.platform === "win32"
                        ? join(paths[0]!, "python.exe")
                        : join(paths[0]!, "bin", "python3");
                const rg = join(paths[1]!, process.platform === "win32" ? "rg.exe" : "rg");
                try {
                    for (const [file, root] of [
                        [python, paths[0]!],
                        [rg, paths[1]!],
                    ]) {
                        const canonicalFile = realpathSync(file!);
                        const child = relative(root!, canonicalFile);
                        if (
                            child === "" ||
                            child === ".." ||
                            child.startsWith("..\\") ||
                            child.startsWith("../") ||
                            isAbsolute(child) ||
                            !statSync(canonicalFile).isFile()
                        )
                            throw new Error(INVALID);
                    }
                } catch {
                    throw new Error(INVALID);
                }
                return paths;
            }
            if (performance.now() >= deadline)
                throw new Error(
                    "Komut araçlarının hazırlanması zaman aşımına uğradı. İnternet bağlantınızı kontrol edip CyberFi’yi yeniden açın.",
                );
            await delay(100, undefined, { signal });
        }
    };
}

/** Re-adopted daemons may still carry the PATH from an older desktop installation. */
export function cyberFiCommandToolsEnvironment(
    paths: readonly string[],
    environment: NodeJS.ProcessEnv,
    command: Readonly<Record<string, string | null>> | undefined,
): Readonly<Record<string, string | null>> {
    const isPath = (key: string) =>
        process.platform === "win32" ? key.toLowerCase() === "path" : key === "PATH";
    const supplied = Object.entries(command ?? {}).filter(([key]) => isPath(key));
    const inherited = Object.entries(environment).filter(([key]) => isPath(key));
    if (supplied.length > 1) throw new Error(INVALID);
    inherited.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const entry = supplied[0] ?? inherited[0],
        key = entry?.[0] ?? "PATH",
        value = entry?.[1];
    const result: Record<string, string | null> = { ...command };
    for (const [other] of [...supplied, ...inherited]) if (other !== key) result[other] = null;
    if (value === null) {
        result[key] = null;
        return result;
    }
    const prefix = [process.platform === "win32" ? paths[0]! : join(paths[0]!, "bin"), paths[1]!];
    result[key] = [
        ...prefix,
        ...(value?.split(delimiter).filter((value) => !prefix.includes(value)) ?? []),
    ].join(delimiter);
    return result;
}

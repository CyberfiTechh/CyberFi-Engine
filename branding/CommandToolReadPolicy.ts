import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

/** Grant only the desktop installer's two managed command-runtime directories. */
export function cyberFiCommandToolReadDirectories(
    agentHome: string,
    raw: string | undefined,
): string[] {
    if (raw === undefined || raw.length > 16_384 || !isAbsolute(agentHome)) return [];
    const target = process.platform + "-" + process.arch;
    const rgDirectories: Record<string, string> = {
        "win32-x64": "ripgrep-15.2.0-x86_64-pc-windows-msvc",
        "darwin-x64": "ripgrep-15.2.0-x86_64-apple-darwin",
        "darwin-arm64": "ripgrep-15.2.0-aarch64-apple-darwin",
    };
    const rgDirectory = rgDirectories[target];
    if (rgDirectory === undefined) return [];
    try {
        const paths: unknown = JSON.parse(raw);
        if (
            !Array.isArray(paths) ||
            paths.length !== 2 ||
            paths.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
            new Set(paths).size !== 2
        )
            return [];
        const lexicalRoot = dirname(dirname(agentHome));
        const managedRoot = realpathSync(lexicalRoot);
        const privateRoot = dirname(realpathSync(agentHome));
        const home = realpathSync(homedir());
        const base = join(managedRoot, "mcp-runtime", "runtimes");
        const lexicalBase = join(lexicalRoot, "mcp-runtime", "runtimes");
        // Reject redirected runtime ancestors as well as redirected leaf directories.
        if (relative(base, realpathSync(lexicalBase)) !== "") return [];
        const expected = [
            join(lexicalBase, "python-" + target, "python"),
            join(lexicalBase, "rg-" + target, rgDirectory),
        ];
        const requested = expected.filter((value) =>
            paths.some((path) => relative(value, path) === ""),
        );
        if (requested.length !== 2) return [];
        const inside = (parent: string, child: string): boolean => {
            const path = relative(parent, child);
            return (
                path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep))
            );
        };
        const missing = (error: unknown): boolean =>
            error instanceof Error && "code" in error && error.code === "ENOENT";
        const result: string[] = [];
        for (const path of requested) {
            let canonical: string | undefined;
            for (const candidate of [dirname(path), path]) {
                try {
                    canonical = realpathSync(candidate);
                } catch (error) {
                    if (!missing(error)) return [];
                    try {
                        lstatSync(candidate);
                    } catch (absent) {
                        if (missing(absent)) {
                            canonical = undefined;
                            break;
                        }
                    }
                    // A dangling link is not a normally uninstalled runtime.
                    return [];
                }
                if (
                    relative(join(base, relative(lexicalBase, candidate)), canonical) !== "" ||
                    !statSync(canonical).isDirectory() ||
                    inside(canonical, home) ||
                    inside(canonical, privateRoot) ||
                    inside(privateRoot, canonical)
                )
                    return [];
            }
            if (canonical === undefined) continue;
            result.push(canonical);
        }
        return result;
    } catch {
        return [];
    }
}

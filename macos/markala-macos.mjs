import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
}).trim();
if (revision !== "3d672e414d70804cf9f1b20b44d7243c78e063c3")
    throw new Error("Beklenen motor kaynak revizyonu bulunamadı.");
const native = join(root, "packages/happy-agent-modules/sources/menuBar/native");
const replacements = {
    "MenuBarController.swift": [
        ['"Quit Happy"', '"CyberFi motorunu kapat"'],
        ['"Quitting Happy…"', '"CyberFi motoru kapatılıyor…"'],
        ['"Could not quit Happy"', '"CyberFi kapatılamadı"'],
        ['"Happy Agent"', '"CyberFi ajan motoru"'],
    ],
    "QuitHappy.swift": [
        [
            '"Happy Desktop could not quit. Close it and try again."',
            '"Masaüstü uygulaması kapatılamadı. Kapatıp tekrar deneyin."',
        ],
        [
            '"Happy Desktop is still closing. Try again once it has quit."',
            '"Masaüstü uygulaması kapanıyor. Kapandıktan sonra tekrar deneyin."',
        ],
        [
            '"Happy Agent could not shut down. Please try again."',
            '"CyberFi ajan motoru kapatılamadı. Tekrar deneyin."',
        ],
    ],
};
const changes = Object.entries(replacements).map(([name, entries]) => {
    const path = join(native, name);
    let text = readFileSync(path, "utf8");
    for (const [before, after] of entries) {
        if (!text.includes(before)) throw new Error("Beklenen menü metni bulunamadı: " + before);
        text = text.replaceAll(before, after);
    }
    return [path, text];
});
for (const [path, text] of changes) writeFileSync(path, text, "utf8");

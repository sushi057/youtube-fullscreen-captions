// Builds the ZIP that people download from the releases page.
//
// It holds the extension/ folder and nothing else, so the unzipped copy
// matches what the README tells people to select in chrome://extensions.
//
// Contents come from git rather than the working tree, so a release cannot
// pick up a stray local edit.
//
// CommonJS, because it is build tooling for the root package, not shared code.
//
//     npm run pack
//
// Writes dist/caption-mode.zip, using `zip` if it is installed and python3
// otherwise, because neither is guaranteed and Node cannot make a zip alone.

const { execFileSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const root = join(__dirname, "..");
const dist = join(root, "dist");
const out = join(dist, "caption-mode.zip");

const { version } = JSON.parse(
  readFileSync(join(root, "extension", "manifest.json"), "utf8"),
);

function zipUp(cwd, target) {
  const tools = [
    ["zip", ["-qr", target, "extension"]],
    ["python3", ["-m", "zipfile", "-c", target, "extension"]],
  ];
  for (const [command, args] of tools) {
    try {
      execFileSync(command, args, { cwd, stdio: "ignore" });
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("no way to make a zip: install `zip` or python3");
}

const staging = mkdtempSync(join(tmpdir(), "caption-mode-"));
try {
  const tar = execFileSync("git", ["archive", "HEAD", "extension"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", staging], { input: tar });

  mkdirSync(dist, { recursive: true });
  rmSync(out, { force: true });
  zipUp(staging, out);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`packed version ${version} into ${out}`);

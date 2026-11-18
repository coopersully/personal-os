import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseEnvironment } from "./release-environment.mjs";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2];
if (!["simulator", "archive", "upload"].includes(mode)) {
  throw new Error("Usage: ios-build.mjs simulator|archive|upload");
}
const buildEnv = mode === "archive" ? releaseEnvironment(process.env) : process.env;
// Regenerate before every build so app.json, assets and dependencies cannot leave a stale archive.
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: buildEnv });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (mode === "upload") {
  const archive = resolve(root, "build/nohmi.xcarchive");
  // Reading the archive metadata fails before any upload if no archive exists.
  readFileSync(resolve(archive, "Info.plist"));
  const options = readFileSync(resolve(root, "ExportOptions.plist"), "utf8").replace(
    "<string>export</string>",
    "<string>upload</string>",
  );
  const optionsPath = resolve(root, "build/UploadOptions.plist");
  writeFileSync(optionsPath, options);
  run("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archive,
    "-exportOptionsPlist",
    optionsPath,
    "-exportPath",
    "build/upload",
    "-allowProvisioningUpdates",
  ]);
  process.exit(0);
}
run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--no-install"]);
run("pod", ["install"], resolve(root, "ios"));
mkdirSync(resolve(root, "build"), { recursive: true });
const args = [
  "-jobs",
  "2",
  "-workspace",
  "ios/nohmi.xcworkspace",
  "-scheme",
  "nohmi",
  "-configuration",
  "Release",
  "-derivedDataPath",
  "build/DerivedData",
  ...(mode === "simulator"
    ? [
        "-destination",
        "generic/platform=iOS Simulator",
        // Simulator Keychain access requires Xcode's generated entitlements and ad-hoc signing.
        "CODE_SIGNING_ALLOWED=YES",
        "CODE_SIGN_IDENTITY=-",
        "build",
      ]
    : [
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        "build/nohmi.xcarchive",
        "-allowProvisioningUpdates",
        "DEVELOPMENT_TEAM=7J7HDVDCKQ",
        "archive",
      ]),
];
run("xcodebuild", args);

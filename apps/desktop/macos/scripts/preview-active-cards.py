"""Build a disposable sample-only native active-card app. Never reads account storage.

python3 apps/desktop/macos/scripts/preview-active-cards.py [--build-only | --stop]
State/actions: /tmp/nohmi-active-card-preview/state.json and actions.jsonl.
The app exits after 15 minutes. Stop it after UI inspection.
"""
from pathlib import Path
import argparse
import os
import shutil
import signal
import subprocess
import plistlib

ROOT = Path(__file__).resolve().parents[4]
WORK = Path("/tmp/nohmi-active-card-preview")
APP = WORK / "nohmi Active Card Preview.app"
EXECUTABLE = APP / "Contents/MacOS/preview"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--stop", action="store_true")
parser.add_argument("--build-only", action="store_true")
args = parser.parse_args()
for row in subprocess.check_output(["ps", "-axo", "pid=,comm="], text=True).splitlines():
    parts = row.strip().split(maxsplit=1)
    if len(parts) == 2 and parts[1] == str(EXECUTABLE):
        try:
            os.kill(int(parts[0]), signal.SIGTERM)
        except ProcessLookupError:
            pass
if args.stop:
    print("Stopped disposable active-card preview.")
    raise SystemExit(0)
EXECUTABLE.parent.mkdir(parents=True, exist_ok=True)
resources = APP / "Contents/Resources"
resources.mkdir(parents=True, exist_ok=True)
for name in ["sounds", "card-icons"]:
    shutil.copytree(ROOT / "apps/desktop/src-tauri" / name, resources / name, dirs_exist_ok=True)
(APP / "Contents/Info.plist").write_bytes(plistlib.dumps({
    "CFBundleExecutable": "preview", "CFBundleIdentifier": "me.coopersully.nohmi.active-card-preview",
    "CFBundleName": "nohmi Active Card Preview", "CFBundlePackageType": "APPL", "LSUIElement": True,
}))
command = ["xcrun", "swiftc", "-module-name", "NohmiActiveCardPreview", str(ROOT / "apps/desktop/macos/preview/main.swift")]
command += [str(p) for p in sorted((ROOT / "apps/desktop/macos/Sources/IloNative").glob("*.swift"))]
for framework in ["AppKit", "SwiftUI", "UserNotifications", "CoreGraphics", "Security", "ServiceManagement", "WidgetKit", "Carbon"]:
    command += ["-framework", framework]
command += ["-o", str(EXECUTABLE)]
with (WORK / "build.log").open("w") as log:
    subprocess.run(command, check=True, stdout=log, stderr=log)
    subprocess.run(["codesign", "--force", "--sign", "-", str(APP)], check=True, stdout=log, stderr=log)
if not args.build_only:
    subprocess.run(["open", "-g", str(APP)], check=True)
print(APP)

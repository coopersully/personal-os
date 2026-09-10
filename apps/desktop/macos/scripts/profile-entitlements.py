"""Validate provisioned macOS identities before signing the host and its extension."""
import datetime
import fnmatch
import plistlib
import subprocess
import sys


def entitlements(profile, source, bundle_id, app_group, keychain_group, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    if profile.get("ExpirationDate", datetime.datetime.min) <= now:
        raise ValueError("The provisioning profile has expired")
    authorized = profile.get("Entitlements", {})
    result = dict(source)
    identifier = authorized.get("com.apple.application-identifier", authorized.get("application-identifier", ""))
    if not identifier.endswith("." + bundle_id):
        raise ValueError("Provisioning profile does not match " + bundle_id)
    for key, required in [("com.apple.security.application-groups", app_group), ("keychain-access-groups", keychain_group)]:
        if not any(fnmatch.fnmatchcase(required, allowed) for allowed in authorized.get(key, [])):
            raise ValueError("Provisioning profile does not authorize the requested " + key)
        result[key] = [required]
    for key in ["com.apple.application-identifier", "application-identifier", "com.apple.developer.team-identifier"]:
        if key in authorized:
            result[key] = authorized[key]
    if authorized.get("get-task-allow") or authorized.get("com.apple.security.get-task-allow"):
        raise ValueError("Release requires a distribution profile, not a debug profile")
    return result


if __name__ == "__main__":
    profile_path, source_path, destination_path, bundle_id, app_group, keychain_group = sys.argv[1:]
    profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", profile_path]))
    with open(source_path, "rb") as source:
        result = entitlements(profile, plistlib.load(source), bundle_id, app_group, keychain_group)
    with open(destination_path, "wb") as destination:
        plistlib.dump(result, destination)

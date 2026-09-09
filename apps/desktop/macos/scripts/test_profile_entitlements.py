import copy
import datetime
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("profile_entitlements", pathlib.Path(__file__).with_name("profile-entitlements.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.profile = {"ExpirationDate": datetime.datetime(2027, 1, 1), "Entitlements": {
            "com.apple.application-identifier": "TEAM.app.personal-os.desktop",
            "com.apple.developer.team-identifier": "TEAM",
            "com.apple.security.application-groups": ["group.app.personal-os.desktop"],
            "keychain-access-groups": ["TEAM.*"],
        }}

    def resolve(self, profile=None, bundle="app.personal-os.desktop"):
        return module.entitlements(profile or self.profile, {"com.apple.security.cs.allow-jit": True}, bundle,
                                   "group.app.personal-os.desktop", "TEAM.app.personal-os.desktop", datetime.datetime(2026, 9, 8))

    def test_identity_and_existing_host_capabilities_preserved(self):
        result = self.resolve()
        self.assertTrue(result["com.apple.security.cs.allow-jit"])
        self.assertEqual(result["com.apple.developer.team-identifier"], "TEAM")
        self.assertEqual(result["keychain-access-groups"], ["TEAM.app.personal-os.desktop"])

    def test_wrong_bundle_rejected(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.resolve(bundle="app.personal-os.desktop.widgets")

    def test_unprovisioned_groups_rejected(self):
        for key in ["com.apple.security.application-groups", "keychain-access-groups"]:
            profile = copy.deepcopy(self.profile)
            profile["Entitlements"][key] = ["OTHER"]
            with self.assertRaisesRegex(ValueError, "does not authorize"):
                self.resolve(profile)

    def test_expired_and_debug_profiles_rejected(self):
        self.profile["Entitlements"]["get-task-allow"] = True
        with self.assertRaisesRegex(ValueError, "distribution profile"):
            self.resolve()
        self.profile["ExpirationDate"] = datetime.datetime(2026, 1, 1)
        with self.assertRaisesRegex(ValueError, "expired"):
            self.resolve()


if __name__ == "__main__":
    unittest.main()

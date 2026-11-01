"""All credentials/payloads in this file are synthetic, non-secret fixtures."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("vault_check", Path(__file__).with_name("vantage-vault-check.py"))
vault = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vault)
FIXTURE = {"client_id": "fixture-client", "client_secret": "fixture-secret-not-a-credential"}


class SafeFiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.parent.chmod(0o700)
        self.path = self.parent / "identity.json"
        self.path.write_text(json.dumps(FIXTURE))
        self.path.chmod(0o600)

    def test_safe_file(self):
        self.assertEqual(vault.load_identity(self.path), FIXTURE)

    def test_readonly_safe_file(self):
        self.path.chmod(0o400)
        self.assertEqual(vault.load_identity(self.path), FIXTURE)

    def test_other_readers_rejected(self):
        self.path.chmod(0o640)
        with self.assertRaises(vault.Blocked): vault.load_identity(self.path)

    def test_open_parent_rejected(self):
        self.parent.chmod(0o755)
        with self.assertRaises(vault.Blocked): vault.load_identity(self.path)

    def test_symlink_rejected(self):
        link = self.parent / "symlink.json"
        link.symlink_to(self.path)
        with self.assertRaises(vault.Blocked): vault.load_identity(link)

    def test_parent_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as other:
            link = Path(other) / "config"
            link.symlink_to(self.parent, target_is_directory=True)
            with self.assertRaises(vault.Blocked): vault.load_identity(link / self.path.name)

    def test_hardlink_rejected(self):
        os.link(self.path, self.parent / "hardlink.json")
        with self.assertRaises(vault.Blocked): vault.load_identity(self.path)

    def test_missing_file_rejected(self):
        with self.assertRaises(vault.Blocked): vault.load_identity(self.parent / "missing.json")

    def test_invalid_content_redacted(self):
        self.path.write_text("not-json fixture-secret-not-a-credential")
        with self.assertRaises(vault.Blocked) as error: vault.load_identity(self.path)
        self.assertNotIn("fixture-secret", str(error.exception))


class Requests(unittest.TestCase):
    def test_single_exact_key_without_value_refs_or_imports(self):
        client = vault.Vault()
        with patch.object(client, "request", return_value={"secret": {"secretKey": "NEON_API_KEY", "workspace": vault.PROJECT, "environment": "dev", "secretPath": "/", "secretValue": ""}}) as request:
            self.assertTrue(client.present("fixture-access-token", "NEON_API_KEY"))
            url = urllib.parse.urlparse(request.call_args.args[0])
            self.assertEqual(url.path, "/api/v4/secrets/NEON_API_KEY")
            q = urllib.parse.parse_qs(url.query)
            self.assertEqual(q, {"projectId": [vault.PROJECT], "environment": ["dev"], "secretPath": ["/"], "type": ["shared"], "viewSecretValue": ["false"], "expandSecretReferences": ["false"], "includeImports": ["false"]})

    def test_server_ignoring_metadata_only_is_refused_without_value_output(self):
        client = vault.Vault()
        result = {"secret": {"secretKey": "NEON_API_KEY", "workspace": vault.PROJECT, "environment": "dev", "secretPath": "/", "secretValue": "fixture-unrequested-value"}}
        with patch.object(client, "request", return_value=result), self.assertRaises(vault.Blocked) as error:
            client.present("fixture-token", "NEON_API_KEY")
        self.assertNotIn("fixture-unrequested-value", str(error.exception))

    def test_scope_mismatch_rejected(self):
        client = vault.Vault()
        for field in ("secretKey", "workspace", "environment", "secretPath"):
            value = {"secretKey": "NEON_API_KEY", "workspace": vault.PROJECT, "environment": "dev", "secretPath": "/"}; value[field] = "wrong"
            with patch.object(client, "request", return_value={"secret": value}), self.assertRaises(vault.Blocked): client.present("fixture-token", "NEON_API_KEY")

    def test_error_body_and_exception_not_exposed(self):
        client = vault.Vault()
        failure = urllib.error.HTTPError(vault.ORIGIN, 403, "fixture-secret-must-not-appear", {}, io.BytesIO(b"fixture-secret-error-body"))
        with patch.object(client.opener, "open", side_effect=failure), self.assertRaises(vault.Blocked) as error: client.request("/test")
        self.assertEqual(str(error.exception), "vault request refused; HTTP status 403")

    def test_redirect_refused(self):
        self.assertIsNone(vault.NoRedirect().redirect_request(None, None, 302, "", {}, "https://attacker.invalid"))

    def test_unsupported_key_denied_before_network(self):
        client = vault.Vault()
        with patch.object(client, "request") as req, self.assertRaises(vault.Blocked): client.present("fixture-token", "UNNEEDED_KEY")
        req.assert_not_called()

    def test_main_outputs_only_counts(self):
        out = io.StringIO(); err = io.StringIO()
        with patch.object(vault, "load_identity", return_value=FIXTURE), patch.object(vault.Vault, "login", return_value="fixture-access-token"), patch.object(vault.Vault, "present", return_value=True), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(vault.main(["NEON_API_KEY"]), 0)
        self.assertIn("requested=1; present=1", out.getvalue())
        for sensitive in ("fixture-secret", "fixture-access-token"): self.assertNotIn(sensitive, out.getvalue() + err.getvalue())

    def test_no_keys_no_credential_or_network_access(self):
        with patch.object(vault, "load_identity") as read, patch.object(vault.Vault, "login") as login, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(vault.main([]), 2)
        read.assert_not_called(); login.assert_not_called()

    def test_invalid_option_does_not_echo_accidental_credential(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
            vault.main(["--not-a-real-option", "fixture-sensitive-argument"])
        self.assertNotIn("fixture-sensitive-argument", err.getvalue())

    def test_setup_check_does_not_login(self):
        with patch.object(vault, "load_identity", return_value=FIXTURE), patch.object(vault.Vault, "login") as login, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(vault.main(["--check-setup"]), 0)
        login.assert_not_called()

    def test_failure_is_not_automatically_retried(self):
        with patch.object(vault, "load_identity", return_value=FIXTURE), patch.object(vault.Vault, "login", side_effect=vault.Blocked("login unavailable")) as login, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(vault.main(["NEON_API_KEY"]), 2)
        self.assertEqual(login.call_count, 1)


if __name__ == "__main__":
    unittest.main()

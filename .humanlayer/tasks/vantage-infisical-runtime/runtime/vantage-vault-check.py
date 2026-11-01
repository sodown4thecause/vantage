#!/usr/bin/env python3
"""Read-only, metadata-only Infisical connection check; no bulk export or injection."""
import argparse
import json
import os
from pathlib import Path
import resource
import signal
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = "https://infisical.contextfor.dev"
PROJECT = "7fb6b279-71e8-4775-9cb9-55dcc8404733"
ENVIRONMENT = "dev"
SECRET_PATH = "/"
IDENTITY_FILE = Path.home() / ".config/vantage-vault/machine-identity.json"
# Current Neon staging investigation only. Extend deliberately for a later task,
# never discover/export all keys or inherit another VM's general launcher.
ALLOWED_KEYS = frozenset({"NEON_API_KEY", "DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"})
MAX_RESPONSE = 65536


class Blocked(Exception):
    """Only constant, credential-free messages may be supplied."""


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        self.exit(2, "BLOCKED: invalid arguments; supply explicit key names, not credentials\n")


def load_identity(path=IDENTITY_FILE):
    """Open without following the credential/parent symlink; reject unsafe files."""
    parent = None
    fd = None
    try:
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        info = os.fstat(parent)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise Blocked("credential directory must be owned by this user with mode 0700")
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise Blocked("credential must be a regular, single-link file owned by this user")
        if stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
            raise Blocked("credential file must have mode 0600 or 0400")
        if not 0 < info.st_size <= 16384:
            raise Blocked("credential file is empty or too large")
        with os.fdopen(fd, "rb") as stream:
            fd = None
            data = json.loads(stream.read(16385))
        if not isinstance(data, dict) or set(data) != {"client_id", "client_secret"}:
            raise Blocked("credential JSON requires only client_id and client_secret")
        for name in ("client_id", "client_secret"):
            value = data[name]
            if not isinstance(value, str) or not value or len(value) > 4096 or value.startswith("<") or any(ord(c) < 32 for c in value):
                raise Blocked("credential JSON has invalid or placeholder fields")
        return data
    except Blocked:
        raise
    except FileNotFoundError:
        raise Blocked("machine identity has not been securely provisioned") from None
    except (OSError, ValueError, UnicodeError):
        raise Blocked("credential file is unsafe, unreadable or invalid JSON") from None
    finally:
        if fd is not None:
            os.close(fd)
        if parent is not None:
            os.close(parent)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward credentials or Authorization to a redirect destination.
        return None


class Vault:
    def __init__(self):
        # TLS verification stays on; ignore shell proxy overrides. No debug logs.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, *, body=None, token=None, missing_ok=False):
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(ORIGIN + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
        try:
            with self.opener.open(req, timeout=12) as response:
                payload = response.read(MAX_RESPONSE + 1)
                if len(payload) > MAX_RESPONSE:
                    raise Blocked("vault response exceeded the safety limit")
                result = json.loads(payload)
                if not isinstance(result, dict):
                    raise Blocked("vault response was not a JSON object")
                return result
        except urllib.error.HTTPError as error:
            # Never print/read an error body: it could contain credentials/values.
            if error.code == 404 and missing_ok:
                return None
            raise Blocked("vault request refused; HTTP status " + str(error.code)) from None
        except Blocked:
            raise
        except Exception:
            raise Blocked("vault request failed; response and exception details suppressed") from None

    def login(self, identity):
        result = self.request("/api/v1/auth/universal-auth/login", body={
            "clientId": identity["client_id"], "clientSecret": identity["client_secret"],
        })
        token = result.get("accessToken")
        if not isinstance(token, str) or not token or any(ord(c) < 33 or ord(c) > 126 for c in token):
            raise Blocked("vault login did not return a usable credential")
        return token

    def present(self, token, key):
        if key not in ALLOWED_KEYS:
            raise Blocked("key is outside this task's explicit allowlist")
        query = urllib.parse.urlencode({
            "projectId": PROJECT, "environment": ENVIRONMENT, "secretPath": SECRET_PATH,
            "type": "shared", "viewSecretValue": "false", "expandSecretReferences": "false", "includeImports": "false",
        })
        result = self.request("/api/v4/secrets/" + urllib.parse.quote(key, safe="") + "?" + query, token=token, missing_ok=True)
        if result is None:
            return False
        secret = result.get("secret")
        if not isinstance(secret, dict) or secret.get("secretKey") != key or secret.get("workspace") != PROJECT or secret.get("environment") != ENVIRONMENT or secret.get("secretPath") != SECRET_PATH:
            raise Blocked("vault response did not match the requested project/environment/path/key")
        if secret.get("secretValue") not in (None, ""):
            raise Blocked("metadata-only response included a value; content suppressed and check refused")
        # Only presence is returned. Do not log/store/inject the response or value.
        return True


def deadline(_signum, _frame):
    raise Blocked("connection deadline exceeded; no automatic retry")


def main(argv=None):
    parser = SafeParser(description="Check only requested Infisical key metadata; never print values.", allow_abbrev=False)
    parser.add_argument("keys", nargs="*", help="Exact current-task key names; no wildcard or bulk list")
    parser.add_argument("--check-setup", action="store_true", help="Validate local protected credential file only; no network")
    args = parser.parse_args(argv)
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if args.check_setup and args.keys:
            raise Blocked("local setup check takes no keys or credentials")
        if not args.check_setup and (not args.keys or len(args.keys) > len(ALLOWED_KEYS) or len(set(args.keys)) != len(args.keys) or any(k not in ALLOWED_KEYS for k in args.keys)):
            raise Blocked("supply distinct explicitly allowed keys; no wildcard, bulk listing or automatic key discovery")
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(30)
        identity = load_identity()
        if args.check_setup:
            print("PREPARED: protected identity file validated; no login or secret access performed")
            return 0
        vault = Vault()
        token = vault.login(identity)
        found = sum(vault.present(token, key) for key in args.keys)
        print("AUTHENTICATED: requested=" + str(len(args.keys)) + "; present=" + str(found) + "; absent-or-not-visible=" + str(len(args.keys) - found) + "; values-requested=0")
        if found != len(args.keys):
            print("BLOCKED: not all requested keys are visible; verify spelling, permissions and server API support")
            return 3
        print("CONNECTED: requested key metadata accessible; no secret values or Neon connection tested")
        return 0
    except Blocked as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        return 2
    except Exception:
        print("BLOCKED: unexpected failure; details suppressed to protect credentials", file=sys.stderr)
        return 2
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    sys.exit(main())

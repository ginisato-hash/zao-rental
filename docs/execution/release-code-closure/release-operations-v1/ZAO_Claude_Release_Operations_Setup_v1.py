#!/usr/bin/env python3
"""Owner-run, case-scoped Claude Code settings ADDITION ZAO_RELEASE_OPERATIONS_V1 (ZAO Rental release operations after the Production restore PASS).

Technical Director decision (Issue #47 comment 5987066963, section 3): the business approvals for the remaining publication steps already exist; what is missing is the
execution app's permission for the exact commands. This ONE additional, case-scoped addition replaces per-command approval. It reuses the additive method of the reviewed
ZAO_R49_BACKUP_V1 installer (v2, sha256 e45ca483...; its bytes are not changed and it is applied separately or first) and of ZAO_R49_AUTONOMY_V1, which must already be saved.

What it allows (all exact commands; the one wildcard in each rule is a single canonical value that is validated by the reviewed code or by the rule's literal context):
  * the reviewed lifecycle commands (package scripts, byte-pinned below): restore evidence finalizer, the fixed 0054/0055 installer, the exact four EXECUTE grants, the
    worker-role containment / CRON_SECRET bind / dark-proof collector / three-role provision, the worker freshness monitor;
  * Vercel for exactly the existing project and team: the protected dark/final deployment of the accepted source, the non-secret production variables of the plan
    (PRODUCTION_RELEASE_ID, PRODUCTION_WORKER_ACCEPTED_AFTER, PRODUCTION_WORKER_TICK_ACTIVATION, PRODUCTION_PUBLIC_ORIGIN, PRODUCTION_PUBLICATION_APPROVAL) and their removal for
    stop/rollback, deployment inspection, and attaching/inspecting ONLY the host salomon-rental.yuge-zao.com;
  * read-only DNS and HTTPS checks of that one host, and moving the Primary worktree onto the accepted origin/main.
It does not allow (and nothing below mentions): reading a password or token, a raw Neon/Vercel/GitHub POST, a shell wildcard, other projects/roles/domains, reissuing the
existing commercial roles, billing, real payments/refunds/mail, any change of the project's deployment protection (the final protection switch stays the Owner's one
dashboard action or a later separately reviewed helper), DNS provider changes, or any change of permissions.ask/deny, hard/soft deny, hooks, sandbox or managed controls.

No network, package installation, repository edit, git mutation, secret-store write, deployment or test execution is performed by this file. Preview is the default; run
--apply once from the Owner's ordinary Mac terminal, then read the effective configuration back in the Code session. Saving settings and being allowed to run are separate
facts; only the readback proves the latter.
Only these additive entries are written: permissions.allow (exact rules), autoMode.environment and autoMode.allow (ZAO_RELEASE_OPERATIONS_V1 entries). A preservation
assertion proves nothing else changes; the original file is backed up byte-for-byte and --undo restores it only if the file has not changed since.

Note: re-running the AUTONOMY installer replaces autoMode.environment as a whole and would drop this policy's environment entries. If that ever happens, re-run this file
(it is idempotent).
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import glob
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from typing import Any
from urllib.parse import urlsplit

MARKER = "ZAO_RELEASE_OPERATIONS_V1"
AUTONOMY_MARKER = "ZAO_R49_AUTONOMY_V1"
BACKUP_MARKER = "ZAO_R49_BACKUP_V1"
REPO = "ginisato-hash/zao-rental"
RELATIVE_WORKTREE = Path("Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2")
NEON_PROJECT = "curly-union-23141081"
NEON_BRANCH = "br-long-king-azkou4fy"
NEON_DATABASE = "neondb"
VERCEL_PROJECT_ID = "prj_ehUMOzM77em9DVnHJBJffncD5hg7"
VERCEL_PROJECT_NAME = "zao-rental"
VERCEL_SCOPE = "zao-food-map"
PUBLIC_HOST = "salomon-rental.yuge-zao.com"
PUBLIC_ORIGIN = "https://" + PUBLIC_HOST
VERCEL_BIN = Path(".npm/_npx/69f9afb961c37556/node_modules/.bin/vercel")
ACTIVATION_VALUE = "NORMAL_WORKER_TICK_APPROVED"  # packages/core/src/payment/worker-tick.ts WORKER_TICK_ACTIVATION
EVIDENCE_WORKER_DIR = ".local/evidence/production-worker"  # dark-deployment-id.txt (written by Primary), dormant-proof.json (written by the collector)
# Reviewed lifecycle code (PR #51 merged source). Every byte-pinned file must be identical to the reviewed version; the package scripts must be exactly these commands.
PINNED_FILES = {
    "scripts/production-restore-evidence.ts": "2092f424ad1da7c095f12cd363887290bb6273a7d6e979c121e4f2ea0cc2675b",
    "scripts/lib/registry-digest.ts": "a144dfcb1c7b6799daf45628b1f72cd2a6c45ef07713525fcb0ffd08b8d38180",
    "scripts/lib/production-owner-session.ts": "21ff1f63f1df87561f3a244ebd6b499c2a116ee4e77b34e50443f82e266674fc",
    "scripts/production-install-normal-worker.ts": "0fedc4bb9e0d7f8a6d9ca66fb4d51c2ef737fd73565ede175b62a34110904a3f",
    "scripts/production-normal-worker-migration.ts": "1fd13e722b2895ec5cef5a103a96b1137b8dcbf9732d3a1a4b52a08fd20934b5",
    "scripts/production-normal-worker-grants.ts": "16582f0da02b1dc30f9233ae12cd5eaea10e6f57b5fef124aeca0e9233e8285c",
    "scripts/production-worker-credential.ts": "2ce917f92e877c8ebe513cdd1d50331b6672f4d0667e3ee1f755f275afe7a928",
    "scripts/production-worker-dormant-proof.ts": "278e31dac86e745e8fc0c63b4d24fefd5c18bee645681391a48984617903acbe",
    "scripts/production-worker-freshness.ts": "255c1d2618dfad7edec87231bdfa1b88224f333c3741a8c5b2190f89b78ac70c",
    "packages/db/migrations/0054_provisional_receipt_capacity.sql": "6aefbc51e167b2c070c35212e27a83d5a49545cd7012ecbb67ab9c7edfb5aea8",
    "packages/db/migrations/0055_normal_production_worker.sql": "ef13d125dd5a7a516e437f97a8e7e2c418fbe8f6fd70973f1917428e2cfc9f03",
}
LIFECYCLE_COMMANDS = {  # package.json script name -> required exact command
    "production:restore-evidence-finalize": "node --import tsx scripts/production-restore-evidence.ts",
    "production:install-normal-worker-migration": "node --import tsx scripts/production-install-normal-worker.ts migrate",
    "production:install-normal-worker-grants": "node --import tsx scripts/production-install-normal-worker.ts grants",
    "production:worker-roles-contain": "node --import tsx scripts/production-worker-credential.ts contain",
    "production:worker-bind-cron-secret": "node --import tsx scripts/production-worker-credential.ts bind-cron-secret",
    "production:worker-dormant-proof": "node --import tsx scripts/production-worker-dormant-proof.ts",
    "production:worker-roles-provision": "node --import tsx scripts/production-worker-credential.ts provision",
    "monitor:worker-freshness": "node --import tsx scripts/production-worker-freshness.ts",
}
FRESHNESS_FLAGS = ["--expected-active", "--intentional-stop"]
# The Backup installer's pinned files must still be the reviewed ones (this policy builds on the backup chain's helper and evidence directory).
BACKUP_PINNED_FILES = {
    "scripts/production-backup-credential.ts": "e71a9ca8e9e283c619fa4591c9ddd2d28223b7d2ba1515cd9025cd27fb1e5c72",
    "scripts/production-backup-object-get.ts": "64fca6e2628a485394fc9a2b0fa4642e2fab412993985782526eb78056813c08",
    "scripts/production-credential-activation.ts": "f4f96805ccf5d92f4382d545135121b6e3f411cc366c9dc1a113f3b6f7278abf",
    "scripts/production-backup.ts": "a571e89675c70c38d342c54441db66313c976c55b1d31e1be873ece2105596e6",
}
PUBLIC_SMOKE_PATHS = ["/", "/ja", "/en", "/robots.txt", "/sitemap.xml", "/api/readiness"]
# Non-secret production variables Primary sets with `vercel env add NAME production --value V --no-sensitive --yes ...`; value is exact where it is a constant.
ENV_VARIABLES = {
    "PRODUCTION_RELEASE_ID": "*",  # the exact accepted main commit (40 hex); the composition rejects anything else
    "PRODUCTION_WORKER_ACCEPTED_AFTER": "*",  # canonical UTC cutoff YYYY-MM-DDTHH:MM:SSZ (workerTickPlan rejects any other shape)
    "PRODUCTION_WORKER_TICK_ACTIVATION": ACTIVATION_VALUE,
    "PRODUCTION_PUBLIC_ORIGIN": PUBLIC_ORIGIN,
    "PRODUCTION_PUBLICATION_APPROVAL": "*",  # the Owner's publication record (PUBLICATION_HANDOFF), bound to the exact accepted release
}


class SetupError(Exception):
    """A safe, fixed-message setup error; never includes file contents."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def require_string_list(value: Any, name: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise SetupError(name + " must be a JSON array of strings; no file was changed.")
    return value


def load_json_object(data: bytes, label: str) -> dict[str, Any]:
    def no_duplicate_keys(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result
    try:
        value = json.loads(data.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys)
    except (UnicodeError, ValueError) as exc:
        raise SetupError(label + " is not valid, unambiguous JSON; no file was changed.") from exc
    if not isinstance(value, dict):
        raise SetupError(label + " must be a JSON object; no file was changed.")
    return value


def safe_regular_file(path: Path) -> bytes:
    try:
        info = path.lstat()
    except OSError as exc:
        raise SetupError("Required local file is unavailable; no file was changed.") from exc
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
        raise SetupError("Refusing a symlink, non-regular, multiply-linked, or non-owned file.")
    if info.st_size > 2_000_000:
        raise SetupError("Refusing an unexpectedly large settings or package file.")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise SetupError("File changed while reading; no file was changed.")
        return stream.read()


def command(args: list[str], *, cwd: Path) -> str:
    # Git is used only for repository identity, never writes.
    env = dict(os.environ)
    env["GIT_OPTIONAL_LOCKS"] = "0"
    try:
        run = subprocess.run(args, cwd=str(cwd), env=env, capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SetupError("Local identity command could not complete; no file was changed.") from exc
    if run.returncode:
        raise SetupError("Local identity command failed; no file was changed.")
    return run.stdout.strip()


def verify_worktree(home: Path) -> Path:
    worktree = home / RELATIVE_WORKTREE
    if not worktree.is_dir() or worktree.resolve() != worktree:
        raise SetupError("The approved f2 worktree is missing or is reached through a symlink.")
    if Path(command(["git", "rev-parse", "--show-toplevel"], cwd=worktree)).resolve() != worktree:
        raise SetupError("The target directory is not the approved worktree root.")
    remote = command(["git", "remote", "get-url", "origin"], cwd=worktree)
    if remote.startswith("git@github.com:"):
        remote_repo = remote.removeprefix("git@github.com:").removesuffix(".git")
    else:
        parsed = urlsplit(remote)
        if parsed.scheme not in ("https", "ssh") or parsed.hostname != "github.com" or parsed.password:
            raise SetupError("The origin remote is not the approved GitHub repository.")
        if parsed.scheme == "https" and parsed.username:
            raise SetupError("Credential-bearing origin remote refused; it was not printed.")
        remote_repo = parsed.path.strip("/").removesuffix(".git")
    if remote_repo != REPO:
        raise SetupError("The origin remote is not the approved GitHub repository.")
    package = load_json_object(safe_regular_file(worktree / "package.json"), "package.json")
    scripts = package.get("scripts")
    if package.get("name") != "zao-rental" or not isinstance(scripts, dict):
        raise SetupError("package.json does not identify the expected ZAO Rental project.")
    # The only npm commands this policy allows are these package scripts; they must be exactly the reviewed ones.
    if any(scripts.get(name) != expected for name, expected in LIFECYCLE_COMMANDS.items()):
        raise SetupError("The release lifecycle package scripts differ from the reviewed ones; no file was changed.")
    # The lifecycle code, the fixed SQL and the earlier backup chain's files must be byte-identical to what the Technical Director reviewed.
    for relative, digest in {**PINNED_FILES, **BACKUP_PINNED_FILES}.items():
        if sha256(safe_regular_file(worktree / relative)) != digest:
            raise SetupError("A pinned lifecycle file differs from the reviewed version (" + relative + "); no file was changed.")
    return worktree


def vercel_bin(home: Path) -> str:
    return str(home / VERCEL_BIN)


def vercel_target() -> str:
    return f"--project {VERCEL_PROJECT_ID} --scope {VERCEL_SCOPE}"


def context_entries(home: Path) -> list[str]:
    vercel = vercel_bin(home)
    wt = home / RELATIVE_WORKTREE
    target = (f"Neon project {NEON_PROJECT}, branch {NEON_BRANCH}, database {NEON_DATABASE}; Vercel project {VERCEL_PROJECT_ID} ({VERCEL_PROJECT_NAME}) in team scope {VERCEL_SCOPE}; "
              f"host {PUBLIC_HOST}")
    order = ("(1) the Production restore PASS record exists (restore-pass.json, machine-derived, 24 hours from the drill's end); (2) the Primary worktree is clean and at the accepted origin/main; "
             "(3) the fixed 0054/0055 installer, then the exact four EXECUTE grants installer; (4) the three worker roles are contained to a clean NOLOGIN baseline; (5) CRON_SECRET is bound "
             "first and alone; (6) PRODUCTION_RELEASE_ID is set to the accepted main commit; (7) ONE protected deployment of the accepted source with no worker password, cutoff or activation; "
             "(8) the dark-deployment id is recorded and the read-only dormant-proof collector builds the proof from real Vercel readbacks (never a hand-written file, never a manual call, never "
             "a protection change to obtain it; no log lines is not a PASS); (9) within 30 minutes the three worker roles are provisioned one at a time by the reviewed helper; "
             "(10) the cutoff, then the activation (value " + ACTIVATION_VALUE + ") last, then one environment-only deployment and the first ticks are watched; (11) host " + PUBLIC_HOST + " is attached "
             "and its exact DNS record is checked read-only; (12) after the existing release gates, the Owner's publication record and public origin are set and the public smoke is run. "
             "Steps are strictly serial, any failure stops that step and its dependants, and stop/rollback means: remove the activation and cutoff variables, contain the worker roles, redeploy the "
             "recorded accepted deployment.")
    return [
        f"{MARKER}: case-scoped addition to {AUTONOMY_MARKER} and {BACKUP_MARKER} (Issue #47 comment 5987066963, section 3, accepted the scope; the business approvals already exist). Purpose: the release operations "
        f"after the Production restore PASS for {REPO}: {target}. Everything outside these exact targets is not authorized. Not authorized: reading any password or token, raw Neon/Vercel/GitHub POST or PATCH, a "
        f"shell wildcard, other projects, roles or domains, reissuing the ten existing commercial credentials, new billing, real payments, refunds or mail that the Owner did not approve, any change of the "
        f"project's deployment protection (the final protection switch is the Owner's dashboard action), DNS provider changes, permission or hook changes.",
        f"{MARKER} Reviewed code: the only database and credential operations are the package scripts {', '.join(sorted(LIFECYCLE_COMMANDS))}, run as npm --prefix {wt} run <name>. The installer refuses to "
        f"save this policy unless their package.json commands and the lifecycle files (including the fixed SQL migrations 0054 and 0055) are byte-identical to the Technical Director's reviewed version. Each script "
        f"is no-argument, keeps owner connection URIs and passwords in process memory, prints only fixed codes, and has its own admission checks (accepted merged main, clean tree, restore PASS, dark proof).",
        f"{MARKER} Secrets: names are identifiers, not values. Worker role passwords exist only in the helper's memory and go only to Vercel sensitive variables PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER, "
        f"PRODUCTION_WORKER_DB_PASSWORD_WORKER and PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR (and CRON_SECRET) over stdin, written by the helper itself. The variables Primary sets directly are non-secret: "
        f"{', '.join(ENV_VARIABLES)}, using vercel env add NAME production --value V --no-sensitive --yes --project {VERCEL_PROJECT_ID} --scope {VERCEL_SCOPE} ({vercel}). Values: the accepted main commit, a "
        f"canonical UTC cutoff, the constant {ACTIVATION_VALUE}, the origin {PUBLIC_ORIGIN} and the Owner's publication record. No value is read back from a sensitive variable.",
        f"{MARKER} Deployment and domain: vercel deploy --prod --yes from the Primary worktree to exactly the project and scope above, only from the accepted merged main and only in the order above; vercel inspect "
        f"of a deployment; vercel domains add {PUBLIC_HOST} {VERCEL_PROJECT_NAME} and vercel domains inspect {PUBLIC_HOST}. The parent domain yuge-zao.com, its MX/TXT/NS records, other hosts and the DNS "
        f"provider are never touched; the exact record Vercel returns for {PUBLIC_HOST} is given to the Owner. dig and curl are read-only checks of that one host.",
        f"{MARKER} Order and stops: " + order,
    ]


def classifier_allow_entries(home: Path) -> list[str]:
    vercel = vercel_bin(home)
    wt = home / RELATIVE_WORKTREE
    scope = f"For {REPO} and the exact targets named in {MARKER} only"
    names = ", ".join(sorted(LIFECYCLE_COMMANDS))
    envs = ", ".join(ENV_VARIABLES)
    return [
        f"{MARKER} Reviewed lifecycle commands: {scope}, permit exactly npm --prefix {wt} run <name> for these package scripts: {names}. The restore-evidence finalizer is no-argument and derives restore-pass.json from the "
        f"Owner's restore result; the migration and grants installers run only after that record and an accepted-main clean checkout; the worker commands implement contain, CRON_SECRET bind, dormant proof (read-only) and "
        f"the three-role provision with one Neon reset per role behind durable guards. monitor:worker-freshness is a read-only log check (--expected-active or --intentional-stop).",
        f"{MARKER} Vercel variables: {scope}, permit vercel env add NAME production --value V --no-sensitive --yes --project {VERCEL_PROJECT_ID} --scope {VERCEL_SCOPE} and vercel env rm NAME production --yes with the same project and "
        f"scope, with {vercel}, only for NAME in {envs}. The activation value is {ACTIVATION_VALUE}; the origin value is {PUBLIC_ORIGIN}; the others carry one canonical value (accepted main commit, UTC cutoff, publication "
        f"record). Sensitive variables are written only by the reviewed helper, never by this rule.",
        f"{MARKER} Vercel deployment: {scope}, permit vercel deploy --cwd {wt} --prod --yes with --project {VERCEL_PROJECT_ID} --scope {VERCEL_SCOPE} (the protected dark deployment, the environment-only redeployments and "
        f"the rollback to the recorded accepted deployment), and vercel inspect of a deployment id with --scope {VERCEL_SCOPE}. Never from a dirty or non-main source; project protection is never changed.",
        f"{MARKER} Domain: {scope}, permit vercel domains add {PUBLIC_HOST} {VERCEL_PROJECT_NAME} --scope {VERCEL_SCOPE} and vercel domains inspect {PUBLIC_HOST} --scope {VERCEL_SCOPE}; dig +short for A, AAAA and CNAME of "
        f"{PUBLIC_HOST}; and curl -sS -o /dev/null -D - for {', '.join(PUBLIC_ORIGIN + p for p in PUBLIC_SMOKE_PATHS)} (status and headers only). No other host, record or provider.",
        f"{MARKER} Worktree and evidence: {scope}, permit git -C {wt} fetch origin and git -C {wt} switch --detach origin/main (so the installers' accepted-main check can hold) and editing files below {wt}/{EVIDENCE_WORKER_DIR}/ "
        f"(the recorded dark deployment id).",
    ]


def tool_rules(home: Path) -> list[str]:
    vercel = vercel_bin(home)
    worktree = home / RELATIVE_WORKTREE
    q = shlex.quote(str(worktree))
    home_pattern = "~/" + RELATIVE_WORKTREE.as_posix()
    target = vercel_target()
    rules = [f"Bash(npm --prefix {q} run {name})" for name in LIFECYCLE_COMMANDS if name != "monitor:worker-freshness"]
    rules += [f"Bash(npm --prefix {q} run monitor:worker-freshness -- {flag})" for flag in FRESHNESS_FLAGS]
    for name, value in ENV_VARIABLES.items():
        rules.append(f"Bash({vercel} env add {name} production --value {value} --no-sensitive --yes {target})")
        rules.append(f"Bash({vercel} env rm {name} production --yes {target})")
    rules += [f"Bash({vercel} deploy --cwd {q} --prod --yes {target})",
              f"Bash({vercel} inspect dpl_* --scope {VERCEL_SCOPE})",
              f"Bash({vercel} domains add {PUBLIC_HOST} {VERCEL_PROJECT_NAME} --scope {VERCEL_SCOPE})",
              f"Bash({vercel} domains inspect {PUBLIC_HOST} --scope {VERCEL_SCOPE})"]
    rules += [f"Bash(dig +short {record} {PUBLIC_HOST})" for record in ("A", "AAAA", "CNAME")]
    rules += [f"Bash(curl -sS -o /dev/null -D - {PUBLIC_ORIGIN}{path})" for path in PUBLIC_SMOKE_PATHS]
    rules += [f"Bash(git -C {q} fetch origin)", f"Bash(git -C {q} switch --detach origin/main)",
              f"Edit({home_pattern}/{EVIDENCE_WORKER_DIR}/**)"]
    return unique(rules)


def make_delta(home: Path) -> tuple[dict[str, Any], dict[str, str]]:
    vercel = vercel_bin(home)
    q = shlex.quote(str(home / RELATIVE_WORKTREE))
    delta = {"permissions": {"allow": tool_rules(home)},
             "autoMode": {"environment": context_entries(home), "allow": classifier_allow_entries(home)}}
    examples = {
        "restore_evidence": f"npm --prefix {q} run production:restore-evidence-finalize",
        "migration": f"npm --prefix {q} run production:install-normal-worker-migration",
        "grants": f"npm --prefix {q} run production:install-normal-worker-grants",
        "dark_deploy": f"{vercel} deploy --cwd {q} --prod --yes {vercel_target()}",
        "domain": f"{vercel} domains add {PUBLIC_HOST} {VERCEL_PROJECT_NAME} --scope {VERCEL_SCOPE}",
    }
    return delta, examples


def merge_settings(before: dict[str, Any], delta: dict[str, Any]) -> dict[str, Any]:
    after = copy.deepcopy(before)
    for key in ("permissions", "autoMode"):
        if key not in after or not isinstance(after[key], dict):
            raise SetupError(key + " must already exist as an object (apply " + AUTONOMY_MARKER + " first); no file was changed.")
    perms, auto = after["permissions"], after["autoMode"]
    for label in ("allow", "ask", "deny"):
        if label in perms:
            require_string_list(perms[label], "permissions." + label)
    for label in ("environment", "allow", "soft_deny", "hard_deny"):
        if label in auto:
            require_string_list(auto[label], "autoMode." + label)
    if not any(e.startswith(AUTONOMY_MARKER) for e in auto.get("allow", [])) \
            or not any(e.startswith(AUTONOMY_MARKER) for e in auto.get("environment", [])):
        raise SetupError(AUTONOMY_MARKER + " is not saved in autoMode.environment and allow; apply it first. No file was changed.")
    # Append only. Entries of an earlier run of this very policy are replaced so a re-run is idempotent.
    perms["allow"] = unique(perms.get("allow", []) + delta["permissions"]["allow"])
    for label in ("environment", "allow"):
        kept = [e for e in auto.get(label, []) if not e.startswith(MARKER)]
        auto[label] = unique(kept + delta["autoMode"][label])
    # Independent assertions: only these three subtrees changed, and nothing that existed was removed.
    stripped_before, stripped_after = copy.deepcopy(before), copy.deepcopy(after)
    for data in (stripped_before, stripped_after):
        for outer, inner_keys in (("permissions", ["allow"]), ("autoMode", ["environment", "allow"])):
            obj = data.get(outer)
            if isinstance(obj, dict):
                for inner in inner_keys:
                    obj.pop(inner, None)
                if not obj:
                    data.pop(outer, None)
    if stripped_before != stripped_after:
        raise SetupError("Preservation check failed; no file was changed.")
    for outer, label in (("permissions", "allow"), ("autoMode", "environment"), ("autoMode", "allow")):
        old = [e for e in before.get(outer, {}).get(label, []) if not e.startswith(MARKER)]
        if any(e not in after[outer][label] for e in old):
            raise SetupError("Preservation check failed (an existing entry would be removed); no file was changed.")
    return after


def atomic_write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".zao-release-ops-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def serialized(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def secure_directory(path: Path) -> None:
    if path.exists():
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise SetupError("Refusing a symlink, non-directory, or non-owned config directory.")
    else:
        path.mkdir(mode=0o700)


def claude_executable(home: Path) -> str | None:
    found = shutil.which("claude")
    if found:
        return found
    pattern = str(home / "Library/Application Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude")
    candidates = sorted(glob.glob(pattern))
    return candidates[-1] if candidates else None


def effective_check(home: Path) -> dict[str, Any]:
    # Read-only; no mutation and no denied operation is retried to test permission settings.
    executable = claude_executable(home)
    if not executable:
        return {"state": "DESKTOP_SESSION_READBACK_REQUIRED", "reason": "Claude CLI was not found."}
    try:
        run = subprocess.run([executable, "auto-mode", "config"], cwd=str(home / RELATIVE_WORKTREE),
                             capture_output=True, text=True, timeout=30, check=False)
        if run.returncode:
            return {"state": "DESKTOP_SESSION_READBACK_REQUIRED", "reason": "Read-only auto-mode config was unavailable; no retry was made."}
        result = load_json_object(run.stdout.encode(), "effective auto-mode config")
        context, allow = result.get("environment", []), result.get("allow", [])
        if not (isinstance(context, list) and isinstance(allow, list)):
            raise ValueError("unexpected shape")
        success = all(e in context for e in context_entries(home)) \
            and all(e in allow for e in classifier_allow_entries(home)) \
            and any(e.startswith(AUTONOMY_MARKER) for e in allow) \
            and any(e.startswith(AUTONOMY_MARKER) for e in context)
        return {"state": "CLI_EFFECTIVE_CONFIRMED" if success else "EFFECTIVE_CONTEXT_NOT_CONFIRMED",
                "desktop_same_session_verified": False}
    except (OSError, subprocess.TimeoutExpired, SetupError, ValueError):
        return {"state": "DESKTOP_SESSION_READBACK_REQUIRED", "reason": "Could not parse read-only effective configuration; raw output was not disclosed."}


def manifest(home: Path) -> dict[str, Any]:
    """The exact entries this installer would append, for review. Writes nothing."""
    delta, _ = make_delta(home)
    return {"policy": MARKER, "permissions.allow": delta["permissions"]["allow"], "autoMode.environment": delta["autoMode"]["environment"],
            "autoMode.allow": delta["autoMode"]["allow"], "pinned_files": {**PINNED_FILES, **BACKUP_PINNED_FILES}, "package_scripts": LIFECYCLE_COMMANDS}


def apply(home: Path, *, do_apply: bool) -> dict[str, Any]:
    configured = os.environ.get("CLAUDE_CONFIG_DIR")
    if configured and Path(configured).expanduser().resolve() != (home / ".claude").resolve():
        raise SetupError("CLAUDE_CONFIG_DIR points elsewhere. Refusing to edit an inactive settings file.")
    worktree = verify_worktree(home)
    config_dir = home / ".claude"
    secure_directory(config_dir) if config_dir.exists() else None
    path = config_dir / "settings.json"
    if not (path.exists() or path.is_symlink()):
        raise SetupError("settings.json does not exist; apply " + AUTONOMY_MARKER + " first.")
    original = safe_regular_file(path)
    before = load_json_object(original, "settings.json")
    delta, examples = make_delta(home)
    after = merge_settings(before, delta)
    next_bytes = serialized(after)
    summary: dict[str, Any] = {
        "policy": MARKER, "requires": AUTONOMY_MARKER, "builds_on": BACKUP_MARKER, "repository": REPO,
        "targets": {"neon_project": NEON_PROJECT, "neon_branch": NEON_BRANCH, "neon_database": NEON_DATABASE,
                    "vercel_project": VERCEL_PROJECT_ID, "vercel_scope": VERCEL_SCOPE, "public_host": PUBLIC_HOST},
        "state": "PREVIEW_ONLY", "worktree": str(worktree),
        "changed_fields": ["permissions.allow (additive, exact commands)", "autoMode.environment (additive)", "autoMode.allow (additive)"],
        "preserved": ["permissions.ask/deny", "mode selection", "autoMode.soft_deny/hard_deny",
                      "every existing environment/allow entry incl. " + AUTONOMY_MARKER, "hooks", "sandbox", "managed-policy controls", "all other settings"],
        "not_granted": ["reading any password or token", "raw Neon/Vercel/GitHub POST or PATCH", "project deployment protection change", "DNS provider or parent-domain records",
                        "other projects/roles/domains", "reissuing the existing commercial roles", "unapproved payments/refunds/mail", "billing"],
        "lifecycle_commands": sorted(LIFECYCLE_COMMANDS),
        "pinned_files": len({**PINNED_FILES, **BACKUP_PINNED_FILES}),
        "variables_set_by_primary": sorted(ENV_VARIABLES),
        "new_environment_entries": len(delta["autoMode"]["environment"]),
        "new_classifier_allow_entries": len(delta["autoMode"]["allow"]),
        "added_tool_rules": len(set(after["permissions"]["allow"]) - set(before.get("permissions", {}).get("allow", []))),
        "command_examples": examples,
        "repository_mutations": 0, "explicit_network_calls": 0, "test_runs": 0,
    }
    if not do_apply:
        return summary
    if after == before:
        summary["state"] = "ALREADY_SAVED"
        summary["readback"] = effective_check(home)
        return summary
    backups = config_dir / "zao-release-ops-backups"
    secure_directory(backups)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = backups / stamp
    backup_dir.mkdir(mode=0o700)
    backup_path = backup_dir / "settings.before.json"
    atomic_write(backup_path, original)
    atomic_write(backup_dir / "task-delta.json", serialized(delta))
    if safe_regular_file(path) != original:
        raise SetupError("Settings changed concurrently. The original backup is kept; settings were not overwritten.")
    atomic_write(path, next_bytes)
    if safe_regular_file(path) != next_bytes:
        raise SetupError("Readback mismatch. No automatic restore was attempted; preserve all files for reconciliation.")
    summary.update({"state": "SETTINGS_SAVED", "settings_sha256": sha256(next_bytes), "original_sha256": sha256(original),
                    "backup": str(backup_path), "receipt": str(backup_dir / "receipt.json")})
    summary["readback"] = effective_check(home)
    atomic_write(backup_dir / "receipt.json", serialized(summary))
    return summary


def undo(home: Path, receipt_path: Path) -> dict[str, Any]:
    backups = (home / ".claude" / "zao-release-ops-backups").resolve()
    resolved = receipt_path.expanduser().resolve()
    if backups not in resolved.parents or resolved.name != "receipt.json":
        raise SetupError("Undo requires this installer's own local receipt.")
    receipt = load_json_object(safe_regular_file(resolved), "receipt")
    if receipt.get("policy") != MARKER or receipt.get("repository") != REPO:
        raise SetupError("Receipt does not identify this task.")
    path = home / ".claude" / "settings.json"
    if sha256(safe_regular_file(path)) != receipt.get("settings_sha256"):
        raise SetupError("Settings changed after installation; refusing to discard later edits.")
    original = safe_regular_file(resolved.parent / "settings.before.json")
    if sha256(original) != receipt.get("original_sha256"):
        raise SetupError("Original backup hash mismatch.")
    atomic_write(path, original)
    return {"state": "RESTORED", "policy": MARKER, "repository_mutations": 0, "credentials_disclosed": False}


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply the Owner-authorized, scoped ZAO_RELEASE_OPERATIONS_V1 addition; default is preview.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true", help="Back up and apply the documented additions once.")
    group.add_argument("--undo", type=Path, metavar="RECEIPT", help="Restore the exact backup only if settings have not changed since.")
    group.add_argument("--print-manifest", action="store_true", help="Print the exact rules and entries that would be appended (writes nothing).")
    args = parser.parse_args()
    try:
        if sys.platform != "darwin":
            raise SetupError("Run this file on the approved Mac, not a remote/Linux environment.")
        if os.geteuid() == 0:
            raise SetupError("Run as the ordinary Owner account, without sudo.")
        home = Path.home().resolve()
        if args.print_manifest:
            result = manifest(home)
        else:
            result = undo(home, args.undo) if args.undo else apply(home, do_apply=args.apply)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("\n設定保存と実行許可の成立は別です。現在のCodeセッションで有効設定を読戻してから続行してください。")
        print("このプログラムは本番変更・secret書込み・Neon/Vercel/GitHub操作・deployを実行していません。")
        return 0
    except SetupError as exc:
        print("SETUP_STOPPED: " + str(exc), file=sys.stderr)
        return 2
    except OSError:
        print("SETUP_STOPPED: Local file access failed; no secret values were printed.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

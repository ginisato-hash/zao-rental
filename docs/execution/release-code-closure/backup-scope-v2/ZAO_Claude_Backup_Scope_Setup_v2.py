#!/usr/bin/env python3
"""Owner-run, case-scoped Claude Code settings ADDITION ZAO_R49_BACKUP_V1, v2 (ZAO Rental pre-migration Production backup).

v2 (Technical Director, Issue #47 comment 5981827674): three GitHub variables in scope incl. AGE_BACKUP_RECIPIENT; NO raw
Neon reset_password POST rule - only the secret-safe helper `scripts/production-backup-credential.ts` (four exact lifecycle
`npm run backup:*` commands) is allowed, and this installer refuses to run unless that helper and its direct imports are
byte-identical to the reviewed versions pinned below; backup-role lifecycle with a 90-minute database-clock LOGIN lease;
the produced ciphertext is fetched only through one pinned read-only wrapper (`npm run backup:object-get`), never by a raw
`wrangler r2 object get` (TD review of PR #50, M1).

Additive to ZAO_R49_AUTONOMY_V1 (it refuses to run unless that policy is already saved). No network, package installation,
repository edit, git mutation, secret-store write, deployment, or test execution is performed. Preview is the default;
use --apply once from the Owner's ordinary Mac terminal (only after the Technical Director accepts this version).

Only the documented, additive entries below are written:
  permissions.allow     (exact command and path rules appended)
  autoMode.environment  (ZAO_R49_BACKUP_V1 entries appended; every existing entry stays)
  autoMode.allow        (ZAO_R49_BACKUP_V1 entries appended; every existing entry stays)
Never changed: permissions.ask/deny, autoMode.soft_deny/hard_deny, hooks, sandbox, managed-policy controls, mode
selection, credentials, and every other key. A preservation assertion proves this before anything is written, the
original file is backed up byte-for-byte, and --undo restores it only if the file has not changed since.

Note: re-running the AUTONOMY installer afterwards replaces autoMode.environment as a whole and would drop this
policy's environment entries. If that ever happens, re-run this file (it is idempotent).
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
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from typing import Any
from urllib.parse import urlsplit

MARKER = "ZAO_R49_BACKUP_V1"
AUTONOMY_MARKER = "ZAO_R49_AUTONOMY_V1"
REPO = "ginisato-hash/zao-rental"
RELATIVE_WORKTREE = Path("Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2")
NEON_PROJECT = "curly-union-23141081"
NEON_BRANCH = "br-long-king-azkou4fy"
NEON_DATABASE = "neondb"
NEON_ROLE = "neondb_backup"
GH_ENV = "production-backup"
BUCKET = "zao-rental-prod-backup"
WORKFLOW = "production-backup.yml"
LEASE_MINUTES = 90
NEON_BIN = Path(".npm/_npx/978debf9b3a75271/node_modules/.bin/neon")
WRANGLER_BIN = Path(".npm/_npx/32026684e21afda6/node_modules/.bin/wrangler")
# Reviewed helper and read-only download wrapper (commit e803f57 on codex/release-worker-provisional-47, TD review of PR #50) and the helper's direct imports.
HELPER = "scripts/production-backup-credential.ts"
OBJECT_GET = "scripts/production-backup-object-get.ts"
PINNED_FILES = {
    HELPER: "e71a9ca8e9e283c619fa4591c9ddd2d28223b7d2ba1515cd9025cd27fb1e5c72",
    OBJECT_GET: "64fca6e2628a485394fc9a2b0fa4642e2fab412993985782526eb78056813c08",
    "scripts/production-credential-activation.ts": "f4f96805ccf5d92f4382d545135121b6e3f411cc366c9dc1a113f3b6f7278abf",
    "scripts/production-backup.ts": "a571e89675c70c38d342c54441db66313c976c55b1d31e1be873ece2105596e6",
}
HELPER_COMMANDS = {  # package.json script name -> required exact command
    "backup:set-age-recipient": "node --import tsx scripts/production-backup-credential.ts set-age-recipient",
    "backup:role-provision": "node --import tsx scripts/production-backup-credential.ts provision",
    "backup:role-finalize": "node --import tsx scripts/production-backup-credential.ts finalize",
    "backup:role-contain": "node --import tsx scripts/production-backup-credential.ts contain",
    "backup:object-get": "node --import tsx scripts/production-backup-object-get.ts",
}
EVIDENCE_DIR = ".local/evidence/production-backup"  # age-recipient.txt (public), restore-pass.json, reset-attempt.json (helper guard)
# Primary writes this one directly (value on stdin). The five PG sinks are written ONLY by the helper; the two R2
# access-key secrets are Owner-only and absent from every rule and entry below.
CLAUDE_DIRECT_SECRET = "PRODUCTION_BACKUP_R2_ACCOUNT_ID"
OWNER_ONLY_SECRETS = ["PRODUCTION_BACKUP_R2_ACCESS_KEY_ID", "PRODUCTION_BACKUP_R2_SECRET_ACCESS_KEY"]
HELPER_SECRETS = ["PRODUCTION_BACKUP_PGHOST", "PRODUCTION_BACKUP_PGPORT", "PRODUCTION_BACKUP_PGDATABASE",
                  "PRODUCTION_BACKUP_PGUSER", "PRODUCTION_BACKUP_PGPASSWORD"]
GH_VARIABLES = ["PRODUCTION_BACKUP_BUCKET", "AGE_BACKUP_RECIPIENT", "PRODUCTION_BACKUP_ACTIVATION"]


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
        run = subprocess.run(args, cwd=str(cwd), env=env, capture_output=True,
                             text=True, timeout=15, check=False)
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
    # The only commands this policy allows are these package scripts (four lifecycle commands and the read-only object download); they must be exactly the reviewed ones.
    if any(scripts.get(name) != expected for name, expected in HELPER_COMMANDS.items()):
        raise SetupError("The backup helper package scripts differ from the reviewed ones; no file was changed.")
    # The helper and its direct imports must be byte-identical to what the Technical Director reviewed.
    for relative, digest in PINNED_FILES.items():
        if sha256(safe_regular_file(worktree / relative)) != digest:
            raise SetupError("A pinned backup helper file differs from the reviewed version (" + relative + "); no file was changed.")
    return worktree


def tool_paths(home: Path) -> tuple[str, str]:
    return str(home / NEON_BIN), str(home / WRANGLER_BIN)


def context_entries(home: Path) -> list[str]:
    neon, _ = tool_paths(home)
    target = f"Neon project {NEON_PROJECT}, branch {NEON_BRANCH}, database {NEON_DATABASE}, role {NEON_ROLE}"
    order = ("(1) age custody and the R2 credential sinks are ready; (2) {r} is NOLOGIN and passwordless with privilege drift 0; (3) a temporary password is generated in memory; "
             "(4) SET LOCAL ROLE {d}_role_admin; (5) the temporary password is set while NOLOGIN; (6) ONE Neon reset_password POST; (7) the returned operations are finished; "
             "(8) a bounded LOGIN lease of {m} minutes from the DATABASE clock, covering the 30-minute first workflow; (9) a fresh direct TLS verify-full, channel-binding login; "
             "(10) read-only privilege/posture probes; (11) the PG credentials are sunk directly into the GitHub Environment; (12) PRODUCTION_BACKUP_ACTIVATION=R4_APPROVED last; "
             "(13) one Production Backup dispatch on main; (14) workflow SUCCESS; (15) encrypted R2 object readback; (16) Production restore drill PASS; "
             "(17) only after that PASS, steady-state LOGIN with VALID UNTIL 'infinity'; (18) then the hourly scheduler is enabled (outside this scope). "
             "Steps 1-12 are the provision helper, 17 is the finalize helper. On any failure: the scheduler is not enabled, PRODUCTION_BACKUP_PGPASSWORD is deleted, {r} is contained to NOLOGIN PASSWORD NULL, and reset_password is never retried blindly.").format(r=NEON_ROLE, d=NEON_DATABASE, m=LEASE_MINUTES)
    return [
        f"{MARKER}: case-scoped addition to {AUTONOMY_MARKER} (Issue #47 comment 5981665275 accepted it; v2 per comment 5981827674). Purpose: the pre-migration Production backup chain for {REPO} (backup, R2 readback, download, decrypt, disposable loopback PostgreSQL restore, invariants, RPO/RTO, cleanup) before migrations 0054/0055. Exact targets only: {target}; GitHub Environment {GH_ENV} of {REPO}; the existing private Cloudflare R2 bucket {BUCKET}. These are destinations the Owner designated, not general trust. This entry changes nothing in {AUTONOMY_MARKER}, permission ask/deny rules, classifier hard_deny/soft_deny, hooks, sandbox or managed controls.",
        f"{MARKER} Neon identity: the Neon CLI at {neon} is the Owner's already-authenticated client; only the exact project, branch, database and role above may be addressed. Not authorized: neon me, projects list, orgs, api-keys, credentials, connection-string, psql, link/set-context, any other project/branch/database/role, branch create/reset/restore/delete, snapshots, endpoint restart or suspend, role create/delete, API-key or token creation, a raw reset_password or reveal_password call, reading ~/.config/neon or any other credential file. The only POST is the one inside the reviewed helper.",
        f"{MARKER} Secrets and custody: names are identifiers, not values. The only credential this scope creates is the single password of role {NEON_ROLE}; it exists only in the helper's process memory and goes only to gh secret set PRODUCTION_BACKUP_PGPASSWORD over stdin (never stdout, logs, argv, a temp or environment file, the Issue or the chat). The helper also holds the neondb_owner connection URI in memory for the lifecycle statements; it is never printed or stored. R2 access-key credentials and the age identity (private key) are Owner-only: Claude never creates, reads, writes, regenerates or requests them, and never asks for permission to read the age identity file. The public age recipient is a non-secret Owner-supplied value.",
        f"{MARKER} Data handling: the downloaded backup object is age ciphertext and stays only in a user-owned mode-0700 directory below the worktree's git-ignored .local/. Decryption needs the Owner-held identity and is run by the Owner as one command that prints only counts and digests. Claude restores only into an owned disposable loopback PostgreSQL named zr_<12 hex> (existing assertDisposableTarget/assertEmptyTarget), never over Production, and removes only successful owned disposable resources. No Production row data is read, exported or printed, and Claude writes no plaintext dump. Invariants are counts, migration registry/checksums and fingerprints.",
        f"{MARKER} Order and stops: " + order + f" Migrations 0054/0055, the four EXECUTE grants, worker roles, CRON_SECRET, deployments, DNS and publication stay outside this scope and wait for the restore proof to PASS. A Neon PITR/branch snapshot may be recorded only as an extra read-only restore point (a UTC timestamp inside the project's history-retention window); creating Neon snapshots or branches is not authorized and never replaces the backup/restore proof.",
    ]


def classifier_allow_entries(home: Path) -> list[str]:
    neon, wrangler = tool_paths(home)
    p, b, d, r = NEON_PROJECT, NEON_BRANCH, NEON_DATABASE, NEON_ROLE
    base = f"/projects/{p}"
    reads = ", ".join(f"{neon} api {path}" for path in (
        base, f"{base}/branches/{b}", f"{base}/branches/{b}/databases", f"{base}/branches/{b}/databases/{d}",
        f"{base}/branches/{b}/roles", f"{base}/branches/{b}/roles/{r}", f"{base}/branches/{b}/endpoints"))
    scope = f"For {REPO} and the exact targets named in {MARKER} only"
    wt = home / RELATIVE_WORKTREE
    return [
        f"{MARKER} Neon read-only verification: {scope}, permit exactly these GET reads: {reads}. They confirm project/branch/database/role identity, that {r} exists, the direct (non-pooled) endpoint host and the project's history retention. They are metadata reads of the Owner's authenticated Neon identity; no credential value is read.",
        f"{MARKER} Backup-role credential lifecycle (Technical Director accepted, v2): {scope}, permit ONLY the reviewed secret-safe helper, through exactly four commands run for {wt}: npm --prefix {wt} run backup:set-age-recipient | backup:role-provision | backup:role-finalize | backup:role-contain. The helper ({HELPER}, sha256 {PINNED_FILES[HELPER][:12]}...; direct imports scripts/production-credential-activation.ts and scripts/production-backup.ts also pinned) is the sole route to the Neon reset_password POST for role {r}: a raw `neon api ... reset_password -X POST`, reveal_password, or any other direct POST/PUT/PATCH/DELETE to Neon is not authorized, and neither is editing the helper or its pinned imports under this entry. Inside, the helper: captures every Neon response in memory (child stdout is never inherited); claims a durable local guard and makes exactly one POST to {base}/branches/{b}/roles/{r}/reset_password, never resending it after an unknown outcome; obtains the owner role's connection URI for database {d} on the exact branch through the Neon API into process memory only (host must equal the exact endpoint host; never printed or stored), solely to run the reviewed role-lifecycle statements (SET LOCAL ROLE {d}_role_admin; ALTER ROLE {r} ...) and read-only role-posture readbacks, with no application-table read; sets the temporary password only while the role is NOLOGIN and never puts a secret in argv; leases LOGIN to a database-clock deadline of {LEASE_MINUTES} minutes (the first Production Backup workflow has a 30-minute timeout); proves a fresh direct TLS verify-full, channel-binding login and read-only posture (no business row is read); sends the new password only to gh secret set PRODUCTION_BACKUP_PGPASSWORD over stdin; sets PRODUCTION_BACKUP_ACTIVATION last; and on any failure contains the role (NOLOGIN PASSWORD NULL VALID UNTIL 'infinity') and deletes that secret and the activation variable. finalize (VALID UNTIL 'infinity') runs only after a restore PASS record exists.",
        f"{MARKER} GitHub Environment {GH_ENV}: {scope}, three variables are in scope: PRODUCTION_BACKUP_BUCKET (= {BUCKET}); AGE_BACKUP_RECIPIENT, the Owner's public age1... recipient, which Claude sets through npm run backup:set-age-recipient only after the helper validates it as a public recipient (a private AGE-SECRET-KEY value is rejected) and never overwrites with a different value; and PRODUCTION_BACKUP_ACTIVATION = R4_APPROVED, set by the provision helper strictly last after every precondition and sink is read back (deleted to stop). Secrets: the helper alone writes {', '.join(HELPER_SECRETS)} (PGHOST is the direct non-pooled host of the exact branch's endpoint and must match the committed Production fingerprint; PGPORT 5432; PGDATABASE {d}; PGUSER {r}); Claude may also write {CLAUDE_DIRECT_SECRET} (a non-secret Cloudflare account id) with gh secret set over stdin. Metadata readback with gh secret list and gh variable list. Not authorized: any other secret or variable, repository- or organization-level secrets, other environments, the Owner-only {', '.join(OWNER_ONLY_SECRETS)}, changing environment protection or the branch policy, or reading a secret value.",
        f"{MARKER} Production Backup run: {scope}, permit exactly one gh workflow run {WORKFLOW} --repo {REPO} --ref main -f scheduled_at=<canonical UTC ISO-8601> after the provision helper reports PROVISIONED and before the LOGIN lease deadline it printed, and read-only inspection (gh run list/view/log, artifacts) of that run. Not authorized: a rerun, a retry after a failed run without a reported cause, another workflow or ref, or a dispatch while PRODUCTION_BACKUP_ACTIVATION is unset. A failed run is read and reported.",
        f"{MARKER} Cloudflare R2: {scope}, permit wrangler ({wrangler}) read-only operations on bucket {BUCKET}: r2 bucket info and r2 bucket lifecycle list, plus one wrangler whoami to read the Cloudflare account id (non-secret) for {CLAUDE_DIRECT_SECRET}. The produced ciphertext is downloaded ONLY through the pinned read-only wrapper npm --prefix {wt} run backup:object-get ({OBJECT_GET}, sha256 {PINNED_FILES[OBJECT_GET][:12]}...): no arguments; the key comes from {wt}/{EVIDENCE_DIR}/object-key.txt and must match the producer's contract (hourly/ or daily/ YYYY/MM/DD/<UTC timestamp>.dump.age); the only wrangler operation is r2 object get {BUCKET}/<key> --remote --file into {wt}/{EVIDENCE_DIR}/<basename> (git-ignored, never overwritten). A raw wrangler r2 object get, object put or delete, bucket create or delete, lifecycle/CORS/domain/public-access changes, token or API-key creation, other buckets or accounts are not authorized.",
        f"{MARKER} Restore proof: {scope}, permit preparing the Owner's input file and one exact restore command (existing npm run restore:production-drill with the PG18 client from npm run setup:pg18-client), the post-restore registry/checksum/critical-fingerprint/row-count checks and RPO/RTO measurement against an owned loopback disposable PostgreSQL, recording the sanitized PASS (object key, ciphertext sha256) and the Owner's public recipient only under {wt}/{EVIDENCE_DIR}/, and cleanup of those owned resources and of Claude's local ciphertext copies. The Owner runs the single decrypt-and-restore command because it needs the private age identity; Claude never asks to read it.",
    ]


def tool_rules(home: Path) -> list[str]:
    neon, wrangler = tool_paths(home)
    worktree = home / RELATIVE_WORKTREE
    q = shlex.quote(str(worktree))
    home_pattern = "~/" + RELATIVE_WORKTREE.as_posix()
    base = f"/projects/{NEON_PROJECT}"
    gh_target = f"--env {GH_ENV} --repo {REPO}"
    rules = [f"Bash({neon} api {path})" for path in (
        base, f"{base}/branches/{NEON_BRANCH}", f"{base}/branches/{NEON_BRANCH}/databases",
        f"{base}/branches/{NEON_BRANCH}/databases/{NEON_DATABASE}", f"{base}/branches/{NEON_BRANCH}/roles",
        f"{base}/branches/{NEON_BRANCH}/roles/{NEON_ROLE}", f"{base}/branches/{NEON_BRANCH}/endpoints")]
    rules += [f"Bash({wrangler} r2 bucket info {BUCKET})",
              f"Bash({wrangler} r2 bucket lifecycle list {BUCKET})",
              f"Bash({wrangler} whoami)"]
    rules += [f"Bash(gh secret list {gh_target})", f"Bash(gh variable list {gh_target})",
              f"Bash(gh secret set {CLAUDE_DIRECT_SECRET} {gh_target})",
              f"Bash(gh variable set PRODUCTION_BACKUP_BUCKET {gh_target} --body {BUCKET})",
              f"Bash(gh secret delete PRODUCTION_BACKUP_PGPASSWORD {gh_target})",
              f"Bash(gh variable delete PRODUCTION_BACKUP_ACTIVATION {gh_target})"]
    # The helper is the only way to reset the role password, sink the PG secrets and set the activation variable.
    rules += [f"Bash(npm --prefix {q} run {name})" for name in HELPER_COMMANDS]
    rules += [f"Edit({home_pattern}/{EVIDENCE_DIR}/**)"]
    # The single wildcard is the canonical UTC timestamp; the workflow accepts no other input.
    rules += [f"Bash(gh workflow run {WORKFLOW} --repo {REPO} --ref main -f scheduled_at=*)"]
    return unique(rules)


def make_delta(home: Path) -> tuple[dict[str, Any], dict[str, str]]:
    neon, wrangler = tool_paths(home)
    q = shlex.quote(str(home / RELATIVE_WORKTREE))
    delta = {"permissions": {"allow": tool_rules(home)},
             "autoMode": {"environment": context_entries(home), "allow": classifier_allow_entries(home)}}
    examples = {
        "neon_read": f"{neon} api /projects/{NEON_PROJECT}/branches/{NEON_BRANCH}/roles/{NEON_ROLE}",
        "r2_read": f"{wrangler} r2 bucket info {BUCKET}",
        "age_recipient": f"npm --prefix {q} run backup:set-age-recipient",
        "provision": f"npm --prefix {q} run backup:role-provision",
        "finalize": f"npm --prefix {q} run backup:role-finalize",
        "contain": f"npm --prefix {q} run backup:role-contain",
        "dispatch": f"gh workflow run {WORKFLOW} --repo {REPO} --ref main -f scheduled_at=<UTC>",
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
    fd, temporary = tempfile.mkstemp(prefix=".zao-backup-scope-", dir=path.parent)
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
    # No mutations or denied operations are retried to test permission settings.
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
        "policy": MARKER, "requires": AUTONOMY_MARKER, "repository": REPO,
        "targets": {"neon_project": NEON_PROJECT, "neon_branch": NEON_BRANCH, "neon_database": NEON_DATABASE,
                    "neon_role": NEON_ROLE, "github_environment": GH_ENV, "r2_bucket": BUCKET},
        "state": "PREVIEW_ONLY", "worktree": str(worktree),
        "changed_fields": ["permissions.allow (additive, exact commands)",
                           "autoMode.environment (additive)", "autoMode.allow (additive)"],
        "preserved": ["permissions.ask/deny", "mode selection", "autoMode.soft_deny/hard_deny",
                      "every existing environment/allow entry incl. " + AUTONOMY_MARKER,
                      "hooks", "sandbox", "managed-policy controls", "all other settings"],
        "owner_only_not_granted": OWNER_ONLY_SECRETS + ["age identity (private key)", "R2 token issuance"],
        "raw_neon_reset_password_rule": "NOT PRESENT (only the pinned helper commands are allowed)",
        "helper": {"file": HELPER, "commands": sorted(HELPER_COMMANDS), "pinned_sha256": PINNED_FILES, "login_lease_minutes": LEASE_MINUTES},
        "github_variables_in_scope": GH_VARIABLES,
        "evidence_dir_edit_rule": EVIDENCE_DIR,
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
    backups = config_dir / "zao-backup-scope-backups"
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
    summary.update({"state": "SETTINGS_SAVED", "settings_sha256": sha256(next_bytes),
                    "original_sha256": sha256(original), "backup": str(backup_path),
                    "receipt": str(backup_dir / "receipt.json")})
    summary["readback"] = effective_check(home)
    atomic_write(backup_dir / "receipt.json", serialized(summary))
    return summary


def undo(home: Path, receipt_path: Path) -> dict[str, Any]:
    backups = (home / ".claude" / "zao-backup-scope-backups").resolve()
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
    parser = argparse.ArgumentParser(description="Apply the Owner-authorized, scoped ZAO_R49_BACKUP_V1 addition; default is preview.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true", help="Back up and apply the documented additions once.")
    group.add_argument("--undo", type=Path, metavar="RECEIPT", help="Restore the exact backup only if settings have not changed since.")
    args = parser.parse_args()
    try:
        if sys.platform != "darwin":
            raise SetupError("Run this file on the approved Mac, not a remote/Linux environment.")
        if os.geteuid() == 0:
            raise SetupError("Run as the ordinary Owner account, without sudo.")
        home = Path.home().resolve()
        result = undo(home, args.undo) if args.undo else apply(home, do_apply=args.apply)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("\n設定保存と実行許可の成立は別です。現在のCodeセッションで有効設定を読戻してから続行してください。")
        print("このプログラムはbackup・secret書込み・Neon/GitHub/R2操作を実行していません。")
        print("ZAO_Claude_Autonomy_Setup.py を再実行するとautoMode.environmentが置換され、本policyの環境記述が消えます。その場合は本スクリプトを再実行してください。")
        return 0
    except SetupError as exc:
        print("SETUP_STOPPED: " + str(exc), file=sys.stderr)
        return 2
    except OSError:
        print("SETUP_STOPPED: Local file access failed; no secret values were printed.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

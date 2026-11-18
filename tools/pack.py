#!/usr/bin/env python3
"""Builds dist/headsup@brickpop.app.shell-extension.zip (ADR-002 §9, G12).

Only files git tracks, under the shipped paths, go in, and only when they are committed:
never an untracked file, an uncommitted change, a symlink, or anything outside the repo. Each entry has a fixed date and mode, so the same tree gives
the same zip. metadata.json gets `version-name` from the git tag (vX.Y.Z), or
"dev <commit>" when HEAD has no tag. Prints the file list.

    tools/pack.py [repo]
"""

import json
import os
import stat
import subprocess
import sys
import zipfile

UUID = "headsup@brickpop.app"
SHIPPED = ["metadata.json", "extension.js", "prefs.js", "stylesheet.css", "LICENSE",
           "schemas", "lib", "worker", "icons"]
DATE = (1980, 1, 1, 0, 0, 0)


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True,
                          text=True).stdout


def shipped_files(repo):
    """Tracked paths under SHIPPED; fails on uncommitted changes there (the zip is the commit
    its version names), a symlink, or a path that leaves the repo."""
    dirty = git(repo, "status", "--porcelain", "--untracked-files=no", "--", *SHIPPED)
    if dirty.strip():
        sys.exit("pack: uncommitted changes in shipped files:\n" + dirty.rstrip())
    root = os.path.realpath(repo)
    files = []
    for line in git(repo, "ls-files", "-s", "-z", "--", *SHIPPED).split("\0"):
        if not line:
            continue
        info, path = line.split("\t", 1)
        mode = info.split()[0]
        # Notes for the people who edit a folder (icon licences, the vendored lexer's hash)
        # aren't part of the extension.
        if os.path.basename(path) == "README.md" or (path.startswith("schemas/") and not path.endswith(".gschema.xml")):
            continue
        full = os.path.join(root, path)
        if not os.path.lexists(full):
            sys.exit(f"pack: {path} is tracked but missing")
        if mode == "120000" or os.path.islink(full):
            sys.exit(f"pack: {path} is a symlink")
        if os.path.commonpath([root, os.path.realpath(full)]) != root:
            sys.exit(f"pack: {path} is outside the repo")
        if not stat.S_ISREG(os.lstat(full).st_mode):
            sys.exit(f"pack: {path} is not a regular file")
        files.append(path)
    return sorted(files)


def version_name(repo):
    tag = subprocess.run(["git", "-C", repo, "describe", "--tags", "--exact-match", "--match", "v[0-9]*"],
                         capture_output=True, text=True)
    if tag.returncode == 0:
        return tag.stdout.strip()[1:]
    return "dev " + git(repo, "rev-parse", "--short=7", "HEAD").strip()


def entry(name):
    info = zipfile.ZipInfo(name, DATE)
    info.external_attr = 0o644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else "."
    files = shipped_files(repo)
    if "metadata.json" not in files:
        sys.exit("pack: metadata.json isn't tracked")
    out = os.path.join(repo, "dist", f"{UUID}.shell-extension.zip")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with zipfile.ZipFile(out, "w") as zf:
        for path in files:
            with open(os.path.join(repo, path), "rb") as f:
                data = f.read()
            if path == "metadata.json":
                metadata = json.loads(data)
                metadata["version-name"] = version_name(repo)
                data = (json.dumps(metadata, indent=2) + "\n").encode()
            zf.writestr(entry(path), data)
    print("\n".join(files))
    print(f"-> {out}")


if __name__ == "__main__":
    main()

# HeadsUp for GNOME. `just` lists the recipes.

uuid := "headsup@brickpop.app"
zip := "dist/" + uuid + ".shell-extension.zip"

# List the recipes
[group('help')]
help:
    @just --list --unsorted

# Install eslint, and gjs into .cache/gjs/ on Debian or Ubuntu machines without it
[group('dev')]
setup:
    npm ci --ignore-scripts --no-audit --no-fund
    @if ! command -v gjs >/dev/null || ! command -v glib-compile-schemas >/dev/null; then tools/setup-gjs.sh; fi

# Run the tests under plain gjs (GSettings in memory: your settings stay untouched)
[group('dev')]
test filter="":
    tools/gjs.sh gjs -m test/run.js {{filter}}

# Run eslint with the project's code rules, then the layer, schema and metadata checks
[group('dev')]
lint:
    tools/lint.sh

# Test, lint, then pack the extension into dist/
[group('build')]
build: test lint
    python3 tools/pack.py

# Install the built extension for your user (log out and in to load it)
[group('build')]
install:
    gnome-extensions install --force {{zip}}

# Run a nested GNOME Shell in a window, to try the installed extension without logging out
[group('dev')]
nested:
    #!/bin/sh
    set -eu
    major=$(gnome-shell --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
    if [ "$major" -ge 49 ]; then mode=--devkit; else mode=--nested; fi
    exec dbus-run-session -- gnome-shell "$mode" --wayland

# Check this machine: GNOME Shell, toolchains, typelibs, systemd scopes, keyring, terminals
[group('dev')]
doctor:
    tools/gjs.sh gjs -m tools/doctor.js

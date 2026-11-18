#!/bin/sh
# The project's lint (ADR-002 §5): eslint with its code rules, then the layer imports, the
# vendored lexer's hash, the schemas and metadata.json. Reports every broken rule, then fails.
# Runs on the repo, or on the folder given (the lint tests do).
#   tools/lint.sh [folder]
set -eu

tools=$(cd "$(dirname "$0")" && pwd)
cd "${1:-.}"
failed=0

# The code rules (logging, eval, markup, sync I/O) are eslint's: it reads the syntax tree.
if ! "$tools/../node_modules/.bin/eslint" --no-warn-ignored --no-error-on-unmatched-pattern -c "$tools/../eslint.config.js" . >&2; then
    echo 'lint: eslint' >&2
    failed=1
fi

# Shipped code: what pack.py puts in the zip, minus data files.
shipped=$(ls -d extension.js prefs.js lib worker 2>/dev/null || true)

# forbid <message> <pattern> <paths…>: fails when a JS file under paths has a line matching
# pattern. For imports and names that one line shows in full.
forbid() {
    message=$1 pattern=$2
    shift 2
    [ $# -gt 0 ] || return 0
    hits=$(grep -rnE --include='*.js' --include='*.mjs' --include='*.cjs' -- "$pattern" "$@" 2>/dev/null || true)
    if [ -n "$hits" ]; then
        printf 'lint: %s\n%s\n' "$message" "$hits" >&2
        failed=1
    fi
}

dirs() {
    for d in "$@"; do [ -e "$d" ] && echo "$d"; done
}

# shellcheck disable=SC2046,SC2086
{
    forbid 'no gi:// imports in lib/core (plain JS, tested with fakes)' \
        'gi://' $(dirs lib/core)
    forbid 'no shell libraries outside lib/shell and extension.js' \
        "gi://(St|Clutter|Meta|Shell|Mtk)|resource:///org/gnome/shell" $(dirs lib/core lib/adapters worker prefs.js lib/prefs)
    forbid 'no GTK, GDK or libadwaita outside prefs' \
        'gi://(Gtk|Gdk|Adw)' $(dirs extension.js lib/core lib/adapters lib/shell worker)
    forbid 'no inbound surfaces (G16)' \
        'bus_own_name|DBusExportedObject|Soup\.Server' $shipped
    forbid 'no TLS overrides (G13)' \
        'accept-certificate|accept_certificate|ssl-strict|ssl_strict' $shipped
}

# The vendored Markdown lexer must be the reviewed one (G12).
if [ -e lib/vendor/marked.esm.js ]; then
    want=$(grep -oE '[0-9a-f]{64}' lib/vendor/README.md 2>/dev/null | head -n 1 || true)
    have=$(sha256sum lib/vendor/marked.esm.js | cut -d' ' -f1)
    if [ "$want" != "$have" ]; then
        echo "lint: lib/vendor/marked.esm.js doesn't match the SHA-256 in lib/vendor/README.md" >&2
        failed=1
    fi
fi

if ! "$tools/gjs.sh" glib-compile-schemas --strict --dry-run schemas; then
    echo 'lint: schemas/ fails glib-compile-schemas --strict' >&2
    failed=1
fi

if ! node -e '
    const m = JSON.parse(require("fs").readFileSync("metadata.json", "utf8"));
    const ok = JSON.stringify(m["shell-version"]) === JSON.stringify(["48", "49", "50", "51"]) && !("version" in m);
    process.exit(ok ? 0 : 1);'; then
    echo 'lint: metadata.json needs shell-version ["48", "49", "50", "51"] and no "version"' >&2
    failed=1
fi

exit "$failed"

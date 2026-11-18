#!/bin/sh
# Runs a command (gjs, glib-compile-schemas) from the gjs toolchain: the system's when gjs
# is installed, else the one `just setup` put in .cache/gjs/.
#   tools/gjs.sh gjs -m test/run.js
set -eu

if ! command -v gjs >/dev/null 2>&1; then
    sysroot="$(cd "$(dirname "$0")/.." && pwd)/.cache/gjs/sysroot"
    if [ ! -x "$sysroot/usr/bin/gjs-console" ]; then
        echo "gjs not found: install it, or run 'just setup'." >&2
        exit 1
    fi
    arch_lib=$(ls -d "$sysroot"/usr/lib/*-linux-gnu | head -n 1)
    export LD_LIBRARY_PATH="$arch_lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export GI_TYPELIB_PATH="$arch_lib/girepository-1.0:$arch_lib/gjs/girepository-1.0${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    export PATH="$sysroot/usr/bin:$arch_lib/glib-2.0:$PATH"
fi
exec "$@"

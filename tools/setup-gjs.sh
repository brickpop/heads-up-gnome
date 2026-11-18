#!/bin/sh
# Installs gjs, its typelibs and glib-compile-schemas into .cache/gjs/, without root.
# Only for Debian or Ubuntu machines that lack gjs (our sandboxes). On a GNOME desktop,
# install your distribution's gjs package instead.
#
# apt checks every index against the keys named in /etc/apt/sources.list.d (Signed-By):
# this script never passes --allow-unauthenticated and never adds [trusted=yes].
set -eu

cd "$(dirname "$0")/.."
root="$PWD/.cache/gjs"
apt_dir="$root/apt"
packages="gjs libglib2.0-bin"

if ! command -v apt-get >/dev/null 2>&1; then
    echo "setup-gjs: apt-get not found. Install gjs and glib-compile-schemas with your package manager." >&2
    exit 1
fi

# apt's own state and cache, in .cache/gjs/apt. The system's sources and keys still apply,
# but not the system's apt.conf.d hooks, which act on /var/cache as root.
mkdir -p "$apt_dir/lists/partial" "$apt_dir/cache/archives/partial" "$apt_dir/parts"
cat >"$apt_dir/apt.conf" <<CONF
Dir::Etc::Parts "$apt_dir/parts";
Dir::State "$apt_dir";
Dir::State::Lists "$apt_dir/lists";
Dir::State::status "/var/lib/dpkg/status";
Dir::Cache "$apt_dir/cache";
Dir::Cache::archives "$apt_dir/cache/archives";
Debug::NoLocking "true";
APT::Sandbox::User "$(id -un)";
CONF
export APT_CONFIG="$apt_dir/apt.conf"

apt-get -qq update

# Every package the list needs, minus those this machine already has.
# shellcheck disable=SC2086
needed=$(apt-cache depends --recurse --no-recommends --no-suggests \
    --no-conflicts --no-breaks --no-replaces --no-enhances $packages |
    grep -E '^[a-z0-9]' | sort -u)
missing=""
for p in $needed; do
    if ! dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed'; then
        missing="$missing $p"
    fi
done

# This run's packages only, downloaded and unpacked in temporary folders. Unpacking there
# also avoids GNU tar's symlink handling, which fails on some shared file systems (virtiofs).
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/debs" "$work/sysroot"
if [ -n "$missing" ]; then
    # shellcheck disable=SC2086
    (cd "$work/debs" && apt-get -qq download $missing)
fi
for deb in "$work"/debs/*.deb; do
    [ -e "$deb" ] || continue
    # Programs and libraries only: no system units, config or docs.
    dpkg-deb --fsys-tarfile "$deb" | tar -x -C "$work/sysroot" \
        --exclude=./etc --exclude=./var --exclude=./usr/share --exclude=./usr/lib/systemd
done
rm -rf "$root/sysroot" "$root/debs"
cp -a "$work/sysroot" "$root/sysroot"

tools/gjs.sh gjs --version

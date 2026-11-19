# HeadsUp for GNOME

HeadsUp as a GNOME Shell extension: a keyboard-first heads-up display with a focus timer, Caffeine, local services, commands and a chat with your own model, opened with **Super+Space**. It runs on GNOME Shell 48 to 51. The Mac app lives in [heads-up](https://github.com/brickpop/heads-up).

Licensed GPL-2.0-or-later (see [LICENSE](./LICENSE)).

## Install on your GNOME desktop

```sh
just setup                 # once: eslint for the build
just build && just install
```

Then log out and in (on Wayland the shell loads new extensions only at login), and turn it on:

```sh
gnome-extensions enable headsup@brickpop.app
```

If something goes wrong, the shell's log shows it:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

To try a change without logging out, `just nested` opens a GNOME Shell in a window, with the installed extension. It shares your session's systemd: when HeadsUp starts there, it stops every HeadsUp service your real session runs.

**Super+Space** also switches keyboard layouts in GNOME. With one layout, HeadsUp moves layout switching to Shift+Super+Space; with two or more, it asks first, in Preferences → General. Turning HeadsUp off gives Super+Space back.

## Develop

Three toolchains, and no other:

| Tool | For | On Fedora |
|---|---|---|
| gjs (with `glib-compile-schemas`) | the tests and the worker | already installed with GNOME |
| node and npm | eslint only | `sudo dnf install nodejs` |
| python3 | `tools/pack.py`, which builds the zip | already installed |

`just setup` runs `npm ci`. On Debian or Ubuntu machines without gjs (our build sandboxes), it also puts gjs into `.cache/gjs/`, without root, from the signed Debian indexes.

`just` lists every recipe:

| Recipe | What it does |
|---|---|
| `just test [filter]` | the tests, under plain gjs; GSettings runs in memory, so your own settings stay untouched |
| `just lint` | `tools/lint.sh`: eslint with the code rules (no sync I/O, logging only through `log.js`, markup only in `markup.js`, no eval), then the layer, schema and metadata checks |
| `just build` | test, lint, then `dist/headsup@brickpop.app.shell-extension.zip` with only the files git tracks |
| `just install` | installs that zip for your user |
| `just nested` | a GNOME Shell in a window (it stops your real session's HeadsUp services) |
| `just doctor` | checks this machine: GNOME Shell, toolchains, typelibs, systemd scopes, keyring, terminals |

### Layout

- `lib/core/`: plain JS, no `gi://` imports: stores, rules, parsers, tested with the fakes in `test/fakes.js`.
- `lib/adapters/`: GLib, Gio and the other system libraries, but never the shell's own (St, Clutter, Meta, Shell). They also run in Preferences and under plain gjs.
- `lib/shell/`: the panel indicator, the HUD and the other parts that need the shell.
- `schemas/`: the settings and the state, in two GSettings schemas.
- `test/`: `test/run.js` runs every `*.test.js`; `tools/`: setup, lint, pack and doctor.

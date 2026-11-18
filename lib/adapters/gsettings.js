// GSettings adapters: one schema as a `KeyValues` port (Settings, State), and GNOME's
// keybindings as the `GnomeKeys` port (ADR-002 §4, §6.3).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {validAccel} from '../core/shortcutClaim.js';

/** A plain JS value with any GLib.Variant inside unpacked, for comparing. */
const plain = value =>
    value instanceof GLib.Variant ? value.recursiveUnpack()
        : Array.isArray(value) ? value.map(plain)
            : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
                : value;

/**
 * The value as a GVariant of `type`, or null when it isn't one already: `new GLib.Variant`
 * coerces ('yes' becomes true, 1.5 becomes 1), so the result must unpack to the same value.
 */
export function toVariant(type, value) {
    try {
        const variant = new GLib.Variant(type, value);
        return JSON.stringify(variant.recursiveUnpack()) === JSON.stringify(plain(value)) ? variant : null;
    } catch {
        return null;
    }
}

/**
 * @param {Gio.Settings} settings  from the extension's `getSettings(schemaId)`
 * @returns {import('../core/ports.js').KeyValues}
 */
export function keyValues(settings) {
    const schema = settings.settings_schema;
    const keyOf = key => {
        if (!schema.has_key(key))
            throw new Error(`unknown key ${key}`);
        return schema.get_key(key);
    };
    return {
        keys: () => schema.list_keys(),
        get: key => keyOf(key) && settings.get_value(key).recursiveUnpack(),
        set: (key, value) => {
            const variant = toVariant(keyOf(key).get_value_type().dup_string(), value);
            if (!variant)
                throw new Error(`wrong type for ${key}`);
            if (!keyOf(key).range_check(variant))
                throw new Error(`value out of range for ${key}`);
            settings.set_value(key, variant);
        },
        reset: key => keyOf(key) && settings.reset(key),
        watch: fn => {
            const id = settings.connect('changed', (_settings, key) => fn(key));
            return {dispose: () => settings.disconnect(id)};
        },
    };
}

const SWITCH_SCHEMA = 'org.gnome.desktop.wm.keybindings';
const SWITCH_KEY = 'switch-input-source';
const BINDING_SCHEMAS = [
    SWITCH_SCHEMA,
    'org.gnome.shell.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];
const MEDIA_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM = `${MEDIA_KEYS}.custom-keybinding`;
const INPUT_SOURCES = 'org.gnome.desktop.input-sources';
const DCONF_FOLDER = /^\/([A-Za-z0-9_-]+\/)+$/;

/**
 * GNOME's keybindings. Schemas this system lacks are skipped. Writes only
 * `switch-input-source`, and only valid accelerators (G8b).
 * @param {Gio.SettingsSchemaSource | null} [source]  the default source; tests pass their own
 * @returns {import('../core/ports.js').GnomeKeys}
 */
export function gnomeKeys(source = Gio.SettingsSchemaSource.get_default()) {
    const open = id => {
        const schema = source?.lookup(id, true);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    };
    const lists = BINDING_SCHEMAS.map(open).filter(Boolean);
    const sources = open(INPUT_SOURCES);
    const media = lists.find(s => s.settings_schema.get_id() === MEDIA_KEYS);
    const customSchema = source?.lookup(CUSTOM, true);
    // Any program of the user can write these paths: only well-formed dconf folders are opened.
    const customs = () => (media && customSchema ? media.get_strv('custom-keybindings') : [])
        .filter(path => DCONF_FOLDER.test(path))
        .map(path => new Gio.Settings({settings_schema: customSchema, path}));

    const accelsOf = (settings, key) => {
        const value = settings.get_value(key);
        if (value.get_type_string() === 'as')
            return value.deepUnpack();
        if (value.get_type_string() === 's')
            return value.deepUnpack() ? [value.deepUnpack()] : [];
        return null;
    };

    return {
        bindings() {
            const found = [];
            for (const settings of lists) {
                const schema = settings.settings_schema;
                for (const key of schema.list_keys()) {
                    if (key === 'custom-keybindings')
                        continue;
                    const accels = accelsOf(settings, key);
                    if (accels) {
                        const name = schema.get_key(key).get_summary() || key;
                        found.push({schema: schema.get_id(), key, name, accels});
                    }
                }
            }
            for (const custom of customs()) {
                const accels = accelsOf(custom, 'binding') ?? [];
                found.push({schema: CUSTOM, key: custom.path, name: custom.get_string('name') || 'Custom shortcut', accels});
            }
            return found;
        },

        inputSourceCount: () => (sources ? sources.get_value('sources').n_children() : 0),

        setSwitchInputSource(accels) {
            const wm = lists.find(s => s.settings_schema.get_id() === SWITCH_SCHEMA);
            if (!wm || !Array.isArray(accels) || !accels.every(validAccel))
                throw new Error('refused to write switch-input-source');
            wm.set_strv(SWITCH_KEY, accels);
        },

        watch(fn) {
            const connections = [];
            const connect = settings => connections.push([settings, settings.connect('changed', () => fn())]);
            let customConnections = [];
            const connectCustoms = () => {
                customConnections.forEach(([s, id]) => s.disconnect(id));
                customConnections = customs().map(s => [s, s.connect('changed', () => fn())]);
            };
            lists.forEach(connect);
            if (sources)
                connections.push([sources, sources.connect('changed::sources', () => fn())]);
            if (media)
                connections.push([media, media.connect('changed::custom-keybindings', connectCustoms)]);
            connectCustoms();
            return {
                dispose: () => {
                    connections.concat(customConnections).forEach(([s, id]) => s.disconnect(id));
                    connections.length = 0;
                    customConnections = [];
                },
            };
        },
    };
}

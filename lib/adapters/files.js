// The `Files` port: whether a folder exists, for the service and command editors.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {expandHome} from './processes.js';

/** @returns {import('../core/ports.js').Files} */
export function files() {
    return {
        isFolder: path => new Promise(resolve => {
            const file = Gio.File.new_for_path(expandHome(path));
            file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (_f, result) => {
                try {
                    resolve(file.query_info_finish(result).get_file_type() === Gio.FileType.DIRECTORY);
                } catch {
                    resolve(false);
                }
            });
        }),
    };
}

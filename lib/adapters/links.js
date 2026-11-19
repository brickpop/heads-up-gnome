// The `Links` port: opens a URI with the user's default handler (ADR-002 §4).

import Gio from 'gi://Gio';

/** @param {import('../core/ports.js').Log} log */
export function links(log) {
    return {
        open(uri) {
            Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (_s, result) => {
                try {
                    Gio.AppInfo.launch_default_for_uri_finish(result);
                } catch {
                    log('links.open-failed');
                }
            });
        },
    };
}

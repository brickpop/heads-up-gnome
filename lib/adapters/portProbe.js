// The `PortProbe` port (ADR-002 §4, §6.4): the port a service listens on, found with
// `ss -ltnpH` (argv, async) among the processes of its scope (the pid's cgroup, read from
// /proc); and whether a port answers, by a TCP connect to 127.0.0.1.

import Gio from 'gi://Gio';

const readText = path => new Promise(resolve => Gio.File.new_for_path(path).load_contents_async(null, (file, result) => {
    try {
        resolve(new TextDecoder().decode(file.load_contents_finish(result)[1]));
    } catch {
        resolve(null);
    }
}));

/** The ports in `ss -ltnpH` output whose process is one of `pids`, lowest first. */
export function portsOf(ssOutput, pids) {
    const ports = [];
    for (const line of ssOutput.split('\n')) {
        const local = line.trim().split(/\s+/)[3];
        const port = Number(local?.slice(local.lastIndexOf(':') + 1));
        const owners = [...line.matchAll(/pid=(\d+)/g)].map(m => Number(m[1]));
        if (Number.isInteger(port) && port > 0 && owners.some(pid => pids.has(pid)))
            ports.push(port);
    }
    return [...new Set(ports)].sort((a, b) => a - b);
}

/** @returns {import('../core/ports.js').PortProbe} */
export function portProbe() {
    return {
        /** The lowest port a process of `pid`'s scope listens on, or null. */
        async listening(pid) {
            if (!Number.isInteger(pid) || pid <= 0)
                return null;
            const cgroup = (await readText(`/proc/${pid}/cgroup`))?.match(/^0::(\/[^\n]*)$/m)?.[1];
            if (!cgroup || cgroup.includes('..'))
                return null;
            const procs = await readText(`/sys/fs/cgroup${cgroup}/cgroup.procs`);
            const pids = new Set((procs ?? '').split('\n').filter(Boolean).map(Number));
            if (!pids.size)
                return null;
            const output = await new Promise(resolve => {
                try {
                    const ss = Gio.Subprocess.new(['ss', '-ltnpH'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
                    ss.communicate_utf8_async(null, null, (_p, result) => {
                        try {
                            resolve(ss.communicate_utf8_finish(result)[1] ?? '');
                        } catch {
                            resolve('');
                        }
                    });
                } catch {
                    resolve('');
                }
            });
            return portsOf(output, pids)[0] ?? null;
        },

        /** Whether something answers on 127.0.0.1:`port` within a second. */
        answers(port) {
            return new Promise(resolve => {
                const client = new Gio.SocketClient({timeout: 1});
                client.connect_to_host_async('127.0.0.1', port, null, (_c, result) => {
                    try {
                        const connection = client.connect_to_host_finish(result);
                        connection.close_async(0, null, () => {});
                        resolve(true);
                    } catch {
                        resolve(false);
                    }
                });
            });
        },
    };
}

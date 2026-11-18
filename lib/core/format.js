// Time formats shared by the indicator, the menu, the footer pills and the tabs (the Mac's
// Format; App shell spec, "Time format"). Times left are in seconds, as on the Mac.

/**
 * Whole minutes for `seconds` left, never below 1.
 * @param {'up' | 'nearest'} rounding  up: a focus with 17 m 01 s left shows 18m; nearest:
 *   caffeine with 17 m 29 s left shows 17m, and halves round up
 */
export function wholeMinutes(seconds, rounding) {
    const minutes = seconds / 60;
    return Math.max(1, rounding === 'up' ? Math.ceil(minutes) : Math.round(minutes));
}

const pad = n => (n < 10 ? `0${n}` : `${n}`);

/** "18m", or "1h 05m" from one hour up. */
export function minutes(seconds, rounding) {
    const total = wholeMinutes(seconds, rounding);
    return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${pad(total % 60)}m`;
}

/** "18:42": minutes and seconds, the seconds rounded up so a timer never shows 0:00 early. */
export function clock(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** For the screen reader: "18 minutes", "1 hour 5 minutes". */
export function spokenMinutes(seconds, rounding) {
    const total = wholeMinutes(seconds, rounding);
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    const parts = [];
    if (hours > 0)
        parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
    if (rest > 0 || hours === 0)
        parts.push(rest === 1 ? '1 minute' : `${rest} minutes`);
    return parts.join(' ');
}

/** "15:30" or "3:30 PM", by GNOME's clock format (Clock.timeFormat()), in local time. */
export function time(date, timeFormat) {
    const h = date.getHours();
    const m = pad(date.getMinutes());
    if (timeFormat === '24h')
        return `${pad(h)}:${m}`;
    return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-11-18": the local calendar day, the `focus-today` key. */
export function day(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The Mac's MenuBarTests for Format, ported, plus the GNOME clock format.

import {test, assertEqual} from '../harness.js';
import {clock, day, minutes, spokenMinutes, time} from '../../lib/core/format.js';

test('minutes: rounded up for focus, to the nearest for caffeine, never below 1', () => {
    assertEqual([minutes(17 * 60 + 1, 'up'), minutes(18 * 60, 'up'), minutes(5, 'up')], ['18m', '18m', '1m']);
    assertEqual([minutes(17 * 60 + 29, 'nearest'), minutes(17 * 60 + 30, 'nearest'), minutes(10, 'nearest')], ['17m', '18m', '1m']);
});

test('minutes: hours from one hour up', () => {
    assertEqual([minutes(65 * 60, 'nearest'), minutes(60 * 60, 'up'), minutes(2 * 3600 + 13 * 60, 'nearest')], ['1h 05m', '1h 00m', '2h 13m']);
});

test('clock: m:ss, seconds rounded up, never negative', () => {
    assertEqual([clock(18 * 60 + 42), clock(3 * 60 + 9.2), clock(0.4), clock(-3), clock(72 * 60)], ['18:42', '3:10', '0:01', '0:00', '72:00']);
});

test('spoken minutes', () => {
    assertEqual([spokenMinutes(18 * 60, 'up'), spokenMinutes(60, 'up'), spokenMinutes(65 * 60, 'nearest'), spokenMinutes(120 * 60, 'nearest')],
        ['18 minutes', '1 minute', '1 hour 5 minutes', '2 hours']);
});

test('time of day by GNOME\'s clock format; the local day', () => {
    const afternoon = new Date(2026, 10, 18, 15, 5);
    const morning = new Date(2026, 10, 18, 0, 30);
    assertEqual([time(afternoon, '24h'), time(afternoon, '12h'), time(morning, '24h'), time(morning, '12h')], ['15:05', '3:05 PM', '00:30', '12:30 AM']);
    assertEqual(day(morning), '2026-11-18');
});

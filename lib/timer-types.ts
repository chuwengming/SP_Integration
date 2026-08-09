/** 週期日：1=週一 … 7=週日 */
export type WeekdayNum = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type TimerDateMode = 'weekly' | 'specific';

export interface RelayTimerSlot {
    slot: number;
    enabled: boolean;
    start: string;
    end: string;
    dateMode: TimerDateMode;
    weekdays: WeekdayNum[];
    specificDate: string;
}

export const SLOTS_PER_RELAY = 6;
export const RELAY_COUNT = 6;

export function emptySlot(slot: number): RelayTimerSlot {
    return {
        slot,
        enabled: false,
        start: '08:00:00',
        end: '08:10:00',
        dateMode: 'weekly',
        weekdays: [],
        specificDate: '',
    };
}

export function defaultRelaySlots(): RelayTimerSlot[] {
    return Array.from({ length: SLOTS_PER_RELAY }, (_, i) => emptySlot(i));
}

/** 將 HH:mm:ss 轉為分鐘（0–1439） */
export function timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/** 區間是否跨日 */
export function isCrossMidnight(start: string, end: string): boolean {
    return timeToMinutes(end) <= timeToMinutes(start);
}

/** 兩區間在分鐘軸上是否重疊（支援跨日） */
function intervalsOverlapMinutes(
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number
): boolean {
    const expand = (s: number, e: number): [number, number][] => {
        if (e > s) return [[s, e]];
        return [[s, 1440], [0, e]];
    };
    const aParts = expand(aStart, aEnd);
    const bParts = expand(bStart, bEnd);
    for (const [as, ae] of aParts) {
        for (const [bs, be] of bParts) {
            if (as < be && bs < ae) return true;
        }
    }
    return false;
}

/** 同一 relay、有效日期重疊時是否衝突 */
export function slotsShareEffectiveDate(a: RelayTimerSlot, b: RelayTimerSlot): boolean {
    if (!a.enabled || !b.enabled) return false;
    if (a.dateMode === 'specific' && b.dateMode === 'specific') {
        return a.specificDate === b.specificDate && a.specificDate.length > 0;
    }
    if (a.dateMode === 'weekly' && b.dateMode === 'weekly') {
        const setB = new Set(b.weekdays);
        return a.weekdays.some((d) => setB.has(d));
    }
    return false;
}

export function slotsTimeOverlap(a: RelayTimerSlot, b: RelayTimerSlot): boolean {
    if (!a.enabled || !b.enabled) return false;
    return intervalsOverlapMinutes(
        timeToMinutes(a.start),
        timeToMinutes(a.end),
        timeToMinutes(b.start),
        timeToMinutes(b.end)
    );
}

export function findOverlapConflict(
    slots: RelayTimerSlot[],
    candidate: RelayTimerSlot,
    ignoreSlot?: number
): RelayTimerSlot | null {
    for (const other of slots) {
        if (other.slot === ignoreSlot) continue;
        if (!other.enabled || !candidate.enabled) continue;
        if (slotsShareEffectiveDate(candidate, other) && slotsTimeOverlap(candidate, other)) {
            return other;
        }
    }
    return null;
}

/** 列表顯示： [1 3 5 7] 或 [2026/05/01] */
export function formatDateDescription(slot: RelayTimerSlot): string {
    if (slot.dateMode === 'specific' && slot.specificDate) {
        const [y, m, d] = slot.specificDate.split('-');
        if (y && m && d) return `[${y}/${m.padStart(2, '0')}/${d.padStart(2, '0')}]`;
        return `[${slot.specificDate}]`;
    }
    if (slot.weekdays.length === 0) return '[—]';
    const sorted = [...slot.weekdays].sort((a, b) => a - b);
    return `[${sorted.join(' ')}]`;
}

export function formatTimeRange(slot: RelayTimerSlot): string {
    const trim = (t: string) => t.slice(0, 5);
    return `${trim(slot.start)} → ${trim(slot.end)}`;
}

/** JS Date → 週期日 1=週一 … 7=週日 */
export function jsDateToWeekdayNum(d: Date): WeekdayNum {
    const day = d.getDay();
    return (day === 0 ? 7 : day) as WeekdayNum;
}

export function maskToWeekdays(mask: number): WeekdayNum[] {
    const out: WeekdayNum[] = [];
    for (let d = 1; d <= 7; d++) {
        if (mask & (1 << (d - 1))) out.push(d as WeekdayNum);
    }
    return out;
}

export function weekdaysToMask(weekdays: WeekdayNum[]): number {
    return weekdays.reduce((m, d) => m | (1 << (d - 1)), 0);
}

export const WEEKDAY_LABELS: Record<WeekdayNum, string> = {
    1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日',
};

export function todayIsoDate(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

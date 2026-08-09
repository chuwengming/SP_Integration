'use client';

import { useMemo, useState } from 'react';
import {
  type RelayTimerSlot,
  type WeekdayNum,
  type TimerDateMode,
  SLOTS_PER_RELAY,
  emptySlot,
  formatDateDescription,
  formatTimeRange,
  findOverlapConflict,
  WEEKDAY_LABELS,
  todayIsoDate,
  isCrossMidnight,
} from '@/lib/timer-types';

type WizardStep = 'list' | 'time' | 'date';

interface TimerSettingsModalProps {
  relayId: number;
  relayName: string;
  slots: RelayTimerSlot[];
  deviceDate?: string;
  deviceTime?: string;
  onClose: () => void;
  onSaveRelay: (slots: RelayTimerSlot[]) => void;
}

function padTime(h: number, m: number, s: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseTime(t: string): [number, number, number] {
  const [h, m, s] = t.split(':').map(Number);
  return [h || 0, m || 0, s || 0];
}

function TimeDrum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [h, m, s] = parseTime(value);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = Array.from({ length: 60 }, (_, i) => i);
  const secs = Array.from({ length: 60 }, (_, i) => i);

  const set = (nh: number, nm: number, ns: number) => onChange(padTime(nh, nm, ns));

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-indigo-200/90 mb-2 text-center tracking-wide">{label}</p>
      <div className="flex gap-1 justify-center bg-slate-900/60 rounded-xl p-2 border border-white/10">
        {[
          { arr: hours, val: h, fn: (v: number) => set(v, m, s) },
          { arr: mins, val: m, fn: (v: number) => set(h, v, s) },
          { arr: secs, val: s, fn: (v: number) => set(h, m, v) },
        ].map((col, idx) => (
          <select
            key={idx}
            value={col.val}
            onChange={(e) => col.fn(Number(e.target.value))}
            className="flex-1 max-w-[4.5rem] bg-slate-800/90 text-white text-center rounded-lg py-2 text-sm font-mono border border-indigo-500/30 focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none cursor-pointer"
          >
            {col.arr.map((n) => (
              <option key={n} value={n}>
                {String(n).padStart(2, '0')}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  );
}

export default function TimerSettingsModal({
  relayId,
  relayName,
  slots,
  deviceDate,
  deviceTime,
  onClose,
  onSaveRelay,
}: TimerSettingsModalProps) {
  const [localSlots, setLocalSlots] = useState<RelayTimerSlot[]>(() =>
    slots.map((s) => ({ ...s, weekdays: [...s.weekdays] }))
  );
  const [step, setStep] = useState<WizardStep>('list');
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [draft, setDraft] = useState<RelayTimerSlot>(() => emptySlot(0));
  const [error, setError] = useState('');

  const activeEntries = useMemo(
    () => localSlots.filter((s) => s.enabled),
    [localSlots]
  );

  const openNew = () => {
    const free = localSlots.findIndex((s) => !s.enabled);
    const slotIdx = free >= 0 ? free : 0;
    setDraft({ ...emptySlot(slotIdx), enabled: true });
    setEditingSlot(slotIdx);
    setError('');
    setStep('time');
  };

  const openEdit = (slotIdx: number) => {
    const src = localSlots[slotIdx];
    setDraft({ ...src, weekdays: [...src.weekdays] });
    setEditingSlot(slotIdx);
    setError('');
    setStep('time');
  };

  const removeSlot = (slotIdx: number) => {
    const next = [...localSlots];
    next[slotIdx] = emptySlot(slotIdx);
    setLocalSlots(next);
    onSaveRelay(next);
  };

  const toggleEnabled = (slotIdx: number) => {
    const next = [...localSlots];
    next[slotIdx] = { ...next[slotIdx], enabled: !next[slotIdx].enabled };
    setLocalSlots(next);
    onSaveRelay(next);
  };

  const proceedToDate = () => {
    if (editingSlot === null) return;
    setError('');
    setStep('date');
  };

  const confirmDateAndSave = () => {
    if (editingSlot === null) return;
    setError('');

    const candidate: RelayTimerSlot = {
      ...draft,
      slot: editingSlot,
      enabled: true,
    };

    if (candidate.dateMode === 'weekly' && candidate.weekdays.length === 0) {
      setError('請至少選擇一個週期日');
      return;
    }
    if (candidate.dateMode === 'specific' && !candidate.specificDate) {
      setError('請選擇指定日期');
      return;
    }

    const conflict = findOverlapConflict(localSlots, candidate, editingSlot);
    if (conflict) {
      setError(`與第 ${conflict.slot + 1} 筆設定時間重疊，無法儲存`);
      return;
    }

    const next = [...localSlots];
    next[editingSlot] = candidate;
    setLocalSlots(next);
    onSaveRelay(next);
    setStep('list');
    setEditingSlot(null);
  };

  const toggleWeekday = (d: WeekdayNum) => {
    setDraft((prev) => {
      const has = prev.weekdays.includes(d);
      const weekdays = has
        ? prev.weekdays.filter((x) => x !== d)
        : [...prev.weekdays, d].sort((a, b) => a - b);
      return { ...prev, weekdays };
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-gradient-to-b from-slate-900 via-slate-900 to-indigo-950">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/10 bg-gradient-to-r from-indigo-600/40 to-violet-600/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-indigo-200/80 text-xs font-medium tracking-widest uppercase">定時設定</p>
              <h3 className="text-xl font-bold text-white mt-0.5">{relayName}</h3>
              <p className="text-indigo-200/60 text-xs mt-1">Relay {relayId + 1}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
          {(deviceDate || deviceTime) && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/25 text-xs text-indigo-100 border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              設備時間 {deviceDate} {deviceTime}
            </div>
          )}
        </div>

        {/* Step tabs */}
        {step !== 'list' && (
          <div className="flex px-5 pt-4 gap-2">
            {(['time', 'date'] as const).map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-1 rounded-full transition-all ${
                  (step === 'time' && i === 0) || (step === 'date' && i <= 1)
                    ? step === s
                      ? 'bg-indigo-400'
                      : 'bg-indigo-400/40'
                    : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'list' && (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-300">已設定 {activeEntries.length} / {SLOTS_PER_RELAY} 組</p>
                <button
                  type="button"
                  onClick={openNew}
                  disabled={activeEntries.length >= SLOTS_PER_RELAY}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-bold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <span className="text-lg leading-none">+</span> 新增
                </button>
              </div>

              {activeEntries.length === 0 ? (
                <div className="text-center py-12 rounded-2xl border border-dashed border-white/15 bg-white/5">
                  <p className="text-4xl mb-3 opacity-60">⏱</p>
                  <p className="text-slate-300 text-sm">尚無定時，點右側 + 新增</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {localSlots.map((slot) =>
                    slot.enabled ? (
                      <li
                        key={slot.slot}
                        className="group rounded-2xl border border-white/10 bg-white/5 hover:bg-white/[0.08] transition-colors overflow-hidden"
                      >
                        <div className="flex items-stretch">
                          <button
                            type="button"
                            onClick={() => openEdit(slot.slot)}
                            className="shrink-0 px-3 py-3 text-xs font-bold text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border-r border-white/10 transition-colors"
                          >
                            編輯
                          </button>
                          <div className="flex-1 px-3 py-3 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded-md">
                                #{slot.slot + 1}
                              </span>
                              {isCrossMidnight(slot.start, slot.end) && (
                                <span className="text-[10px] text-amber-300/90 bg-amber-500/15 px-1.5 py-0.5 rounded">跨日</span>
                              )}
                            </div>
                            <p className="text-white font-semibold text-sm font-mono tracking-tight">
                              {formatTimeRange(slot)}
                            </p>
                            <p className="text-slate-400 text-xs mt-1 font-mono">
                              {formatDateDescription(slot)}
                            </p>
                          </div>
                          <div className="flex flex-col border-l border-white/10">
                            <button
                              type="button"
                              onClick={() => toggleEnabled(slot.slot)}
                              className={`flex-1 px-3 text-xs font-bold transition-colors ${
                                slot.enabled
                                  ? 'text-emerald-400 hover:bg-emerald-500/10'
                                  : 'text-red-400 hover:bg-red-500/10'
                              }`}
                              title={slot.enabled ? '啟用中' : '已停用'}
                            >
                              {slot.enabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSlot(slot.slot)}
                              className="px-3 py-2 text-red-400 hover:bg-red-500/15 text-sm border-t border-white/10"
                              aria-label="刪除"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </li>
                    ) : null
                  )}
                </ul>
              )}
            </>
          )}

          {step === 'time' && (
            <div className="space-y-5">
              <p className="text-center text-slate-300 text-sm">調整開啟與關閉時間</p>
              <div className="flex gap-3">
                <TimeDrum
                  label="開啟"
                  value={draft.start}
                  onChange={(v) => setDraft((p) => ({ ...p, start: v }))}
                />
                <div className="flex items-center text-indigo-300/50 pt-6">→</div>
                <TimeDrum
                  label="關閉"
                  value={draft.end}
                  onChange={(v) => setDraft((p) => ({ ...p, end: v }))}
                />
              </div>
              {isCrossMidnight(draft.start, draft.end) && (
                <p className="text-center text-xs text-amber-300/90 bg-amber-500/10 rounded-lg py-2 px-3">
                  此區間跨日（例如 22:00 → 次日 06:00）
                </p>
              )}
            </div>
          )}

          {step === 'date' && (
            <div className="space-y-5">
              <p className="text-center text-slate-300 text-sm">選擇生效日期</p>

              <div className="flex rounded-xl bg-black/30 p-1 border border-white/10">
                {(['weekly', 'specific'] as TimerDateMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, dateMode: mode }))}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                      draft.dateMode === mode
                        ? 'bg-indigo-500 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'weekly' ? '每週循環' : '指定日期'}
                  </button>
                ))}
              </div>

              {draft.dateMode === 'weekly' ? (
                <div>
                  <p className="text-xs text-slate-400 mb-3 text-center">自由選擇週期（顯示為 [1 3 5 7] 格式）</p>
                  <div className="grid grid-cols-7 gap-2">
                    {([1, 2, 3, 4, 5, 6, 7] as WeekdayNum[]).map((d) => {
                      const on = draft.weekdays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleWeekday(d)}
                          className={`aspect-square rounded-xl flex flex-col items-center justify-center text-sm font-bold transition-all border ${
                            on
                              ? 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/40 scale-105'
                              : 'bg-white/5 border-white/10 text-slate-400 hover:border-indigo-400/50'
                          }`}
                        >
                          <span className="text-[10px] opacity-70">{d}</span>
                          <span>{WEEKDAY_LABELS[d]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-center mt-3 text-xs font-mono text-indigo-200/80">
                    {formatDateDescription(draft)}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="date"
                    value={draft.specificDate || todayIsoDate()}
                    onChange={(e) => setDraft((p) => ({ ...p, specificDate: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl bg-slate-800/80 border border-white/15 text-white text-center font-mono focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                  />
                  <p className="text-center text-xs font-mono text-indigo-200/80">
                    {formatDateDescription({ ...draft, specificDate: draft.specificDate || todayIsoDate() })}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="mt-4 text-center text-sm text-red-300 bg-red-500/15 rounded-lg py-2 px-3 border border-red-500/20">
              {error}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-white/10 bg-black/20 flex gap-3">
          {step === 'list' ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-white/10 text-white font-bold hover:bg-white/15 transition-colors"
            >
              完成
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep(step === 'date' ? 'time' : 'list');
                  if (step === 'time') setEditingSlot(null);
                }}
                className="px-5 py-3 rounded-xl bg-white/10 text-white font-bold hover:bg-white/15"
              >
                {step === 'date' ? '編輯' : '返回'}
              </button>
              {step === 'time' ? (
                <button
                  type="button"
                  onClick={proceedToDate}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-bold shadow-lg shadow-indigo-500/30"
                >
                  下一步：日期
                </button>
              ) : (
                <button
                  type="button"
                  onClick={confirmDateAndSave}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold shadow-lg shadow-emerald-500/30"
                >
                  儲存
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

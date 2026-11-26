'use client';



import { useState, useEffect, useRef, useCallback } from 'react';

import { useRouter } from 'next/navigation';

import { getOperationRoute } from '@/lib/ui-type';

import TimerSettingsModal from '@/components/timer/timer-settings-modal';

import {

  type RelayTimerSlot,

  defaultRelaySlots,

  maskToWeekdays,

  weekdaysToMask,

  RELAY_COUNT,

} from '@/lib/timer-types';



interface Relay {

  id: number;

  name: string;

  state: boolean;

}



function parseSlotsFromMqtt(raw: unknown): RelayTimerSlot[] {

  const base = defaultRelaySlots();

  if (!raw || typeof raw !== 'object') return base;

  const arr = (raw as { slots?: unknown[] }).slots;

  if (!Array.isArray(arr)) return base;

  for (const item of arr) {

    if (!item || typeof item !== 'object') continue;

    const o = item as Record<string, unknown>;

    const slot = Number(o.slot);

    if (slot < 0 || slot >= base.length) continue;

    const weekdays = Array.isArray(o.weekdays)

      ? (o.weekdays as number[]).filter((d) => d >= 1 && d <= 7) as RelayTimerSlot['weekdays']

      : maskToWeekdays(Number(o.weekdaysMask) || 0);

    base[slot] = {

      slot,

      enabled: Boolean(o.enabled),

      start: String(o.start || '08:00:00'),

      end: String(o.end || '08:10:00'),

      dateMode: o.dateMode === 'specific' ? 'specific' : 'weekly',

      weekdays,

      specificDate: String(o.specificDate || ''),

    };

  }

  return base;

}



function slotsToMqttPayload(slots: RelayTimerSlot[]) {

  return slots.map((s) => ({

    slot: s.slot,

    enabled: s.enabled,

    start: s.start,

    end: s.end,

    dateMode: s.dateMode,

    weekdays: s.weekdays,

    weekdaysMask: weekdaysToMask(s.weekdays),

    specificDate: s.specificDate,

  }));

}



function parseTimerFlags(raw: unknown): boolean[] {

  const flags = Array(RELAY_COUNT).fill(false);

  if (Array.isArray(raw)) {

    raw.forEach((v, i) => {

      if (i < RELAY_COUNT) flags[i] = Boolean(v);

    });

  }

  return flags;

}



export default function OperationTimerPanel() {

  const router = useRouter();

  const [pageReady, setPageReady] = useState(false);

  const [relays, setRelays] = useState<Relay[]>(

    Array.from({ length: RELAY_COUNT }, (_, i) => ({

      id: i,

      name: `Relay ${i + 1}`,

      state: false,

    }))

  );

  const [timerByRelay, setTimerByRelay] = useState<Record<number, RelayTimerSlot[]>>(() => {

    const init: Record<number, RelayTimerSlot[]> = {};

    for (let i = 0; i < RELAY_COUNT; i++) init[i] = defaultRelaySlots();

    return init;

  });

  const [timerFlags, setTimerFlags] = useState<boolean[]>(() => Array(RELAY_COUNT).fill(false));

  const [timerCapable, setTimerCapable] = useState(true);

  const [mqttConnected, setMqttConnected] = useState(false);

  const [deviceName, setDeviceName] = useState('載入中…');

  const [deviceDate, setDeviceDate] = useState('');

  const [deviceTime, setDeviceTime] = useState('');

  const [timerModalRelay, setTimerModalRelay] = useState<number | null>(null);

  const [saveError, setSaveError] = useState('');



  type DeviceStatus = 'unknown' | 'online' | 'offline' | 'reconnecting';

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('unknown');



  const wsRef = useRef<WebSocket | null>(null);

  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const pendingTimerRelayRef = useRef<number | null>(null);

  const lastSavedTimerRelayRef = useRef<number | null>(null);

  const timerModalRelayRef = useRef<number | null>(null);

  useEffect(() => {

    timerModalRelayRef.current = timerModalRelay;

  }, [timerModalRelay]);



  const fetchDeviceNameFromMqtt = async () => {

    try {

      const clientId = sessionStorage.getItem('mqttClientId');

      if (!clientId) {

        setDeviceName('—');

        return;

      }

      const response = await fetch(`/api/plugName?clientId=${encodeURIComponent(clientId)}`);

      if (!response.ok) {

        setDeviceName('—');

        return;

      }

      const data = await response.json();

      if (data.plugName && String(data.plugName).trim() !== '') {

        setDeviceName(String(data.plugName).trim());

      }

    } catch (e) {

      console.error('載入設備名稱失敗:', e);

    }

  };



  useEffect(() => {

    let cancelled = false;

    const bootstrap = async () => {

      const clientId = sessionStorage.getItem('mqttClientId');

      const plugId = sessionStorage.getItem('plugId');

      if (!clientId || !plugId) {

        router.replace('/');

        return;

      }

      try {

        const res = await fetch(`/api/registry/ui-type?plugId=${encodeURIComponent(plugId)}`);

        const data = await res.json();

        if (cancelled) return;

        if (data.success && data.uiType) {

          const actual = data.uiType === 'C' ? 'C' : data.uiType === 'B' ? 'B' : 'A';

          sessionStorage.setItem('uiType', actual);

          if (actual !== 'C') {

            router.replace(getOperationRoute(actual));

            return;

          }

        }

      } catch (e) {

        console.warn('無法驗證 uiType:', e);

      }

      if (!cancelled) {

        setPageReady(true);

        fetchDeviceNameFromMqtt();

      }

    };

    bootstrap();

    return () => { cancelled = true; };

  }, [router]);



  const sendCommand = useCallback((command: string, params?: Record<string, unknown>) => {

    if (wsRef.current?.readyState === WebSocket.OPEN) {

      wsRef.current.send(JSON.stringify({ command, ...params }));

    }

  }, []);



  const refetchTimerState = useCallback((relayId: number) => {

    sendCommand('timer_get_relay', { relay_id: relayId });

    sendCommand('get_sensors');

  }, [sendCommand]);



  const handleMessage = useCallback((data: Record<string, unknown>) => {

    switch (data.type) {

      case 'mqtt_status':

        setMqttConnected(Boolean(data.connected));

        break;

      case 'relay_response':

        setRelays((prev) =>

          prev.map((relay) =>

            relay.id === data.relay_id ? { ...relay, state: Boolean(data.state) } : relay

          )

        );

        break;

      case 'relay_name_updated':

        setRelays((prev) =>

          prev.map((relay) =>

            relay.id === data.relay_id ? { ...relay, name: String(data.name) } : relay

          )

        );

        break;

      case 'plug_name_updated':

        if (data.plugName && String(data.plugName).trim() !== '') {

          setDeviceName(String(data.plugName).trim());

        }

        break;

      case 'device_time':

        if (data.date) setDeviceDate(String(data.date));

        if (data.time) setDeviceTime(String(data.time));

        if (data.synced !== undefined) {

          setTimerCapable(Boolean(data.synced && data.timerCapable !== false));

        }

        break;

      case 'timer_flags_updated':

        setTimerFlags(parseTimerFlags(data.flags));

        break;

      case 'timer_updated': {

        const relayId = Number(data.relay_id);

        if (relayId >= 0 && relayId < RELAY_COUNT) {

          setTimerByRelay((prev) => ({

            ...prev,

            [relayId]: parseSlotsFromMqtt(data),

          }));

          if (pendingTimerRelayRef.current === relayId) {

            pendingTimerRelayRef.current = null;

            setTimerModalRelay(relayId);

          }

        }

        break;

      }

      case 'timer_clear_all':

        setTimerFlags(Array(RELAY_COUNT).fill(false));

        break;

      case 'timer_conflict': {

        pendingTimerRelayRef.current = null;

        setSaveError(`定時重疊：Relay ${Number(data.relay_id) + 1} 第 ${Number(data.conflict_slot) + 1} 筆衝突，已拒絕儲存`);

        setTimeout(() => setSaveError(''), 5000);

        // 樂觀更新已被設備拒絕：向設備取回實際槽位與旗標
        const rid = Number(data.relay_id);

        if (rid >= 0 && rid < RELAY_COUNT) refetchTimerState(rid);

        break;

      }

      case 'timer_no_time':

        pendingTimerRelayRef.current = null;

        alert('設備因故無法設定 Timer，請檢查設備端網路');

        if (lastSavedTimerRelayRef.current !== null) refetchTimerState(lastSavedTimerRelayRef.current);

        break;

      case 'device_offline':

        setDeviceStatus('offline');

        break;

      case 'device_reconnecting':

        setDeviceStatus('reconnecting');

        break;

      case 'device_online':

        setDeviceStatus('online');

        // 設備重啟／重連後，開啟中的定時視窗需以設備 NVS 為準重新載入
        if (timerModalRelayRef.current !== null) refetchTimerState(timerModalRelayRef.current);

        break;

    }

  }, [refetchTimerState]);



  const connectWebSocket = useCallback(() => {

    if (reconnectTimerRef.current) {

      clearTimeout(reconnectTimerRef.current);

      reconnectTimerRef.current = null;

    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const clientId = sessionStorage.getItem('mqttClientId') || '';

    const plugId = sessionStorage.getItem('plugId') || '';

    if (!clientId || !plugId) {

      router.replace('/');

      return;

    }

    const wsUrl = `${protocol}//${window.location.host}/api/ws/operation?clientId=${encodeURIComponent(clientId)}&plugId=${encodeURIComponent(plugId)}`;

    wsRef.current?.close();

    const ws = new WebSocket(wsUrl);

    wsRef.current = ws;

    ws.onopen = () => {

      setMqttConnected(true);

      setDeviceStatus('unknown');

      sendCommand('get_sensors');

      fetchDeviceNameFromMqtt();

    };

    ws.onmessage = (event) => {

      try {

        handleMessage(JSON.parse(event.data));

      } catch (e) {

        console.error('解析 WebSocket 訊息失敗:', e);

      }

    };

    ws.onerror = () => setMqttConnected(false);

    ws.onclose = (event: CloseEvent) => {

      setMqttConnected(false);

      if (event.code !== 1000) {

        reconnectTimerRef.current = setTimeout(connectWebSocket, 5000);

      }

    };

  }, [router, sendCommand, handleMessage]);



  useEffect(() => {

    if (!pageReady) return;

    const timer = setTimeout(connectWebSocket, 500);

    return () => {

      clearTimeout(timer);

      wsRef.current?.close();

      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    };

  }, [pageReady, connectWebSocket]);



  const isDeviceReady =

    deviceStatus === 'online' || deviceStatus === 'unknown';



  const toggleRelay = (id: number, state: boolean) => {

    if (!isDeviceReady) return;

    setRelays((prev) => prev.map((r) => (r.id === id ? { ...r, state } : r)));

    sendCommand('relay_control', { relay_id: id, state });

  };



  const openTimerSettings = (relayId: number) => {

    if (!isDeviceReady) return;

    if (!timerCapable) {

      alert('設備因故無法設定 Timer，請檢查設備端網路');

      return;

    }

    pendingTimerRelayRef.current = relayId;

    sendCommand('timer_get_relay', { relay_id: relayId });

  };



  const saveRelayTimers = (relayId: number, slots: RelayTimerSlot[]) => {

    lastSavedTimerRelayRef.current = relayId;

    setTimerByRelay((prev) => ({ ...prev, [relayId]: slots }));

    const hasEnabled = slots.some((s) => s.enabled);

    setTimerFlags((prev) => {

      const next = [...prev];

      next[relayId] = hasEnabled;

      return next;

    });

    sendCommand('timer_set_relay', {

      relay_id: relayId,

      slots: slotsToMqttPayload(slots),

    });

  };



  const handleResetSettings = async () => {

    if (!confirm('確定要重置設備設定嗎？密碼將回復為 123456，繼電器全部關閉，名稱回歸預設，定時設定將全部清除；PlugID 與 ClientID 將保留。')) {

      return;

    }

    try {

      const clientId = sessionStorage.getItem('mqttClientId');

      const plugId = sessionStorage.getItem('plugId') || '';

      if (!clientId || !plugId) {

        alert('缺少連線資訊，請重新登入');

        return;

      }

      const response = await fetch('/api/settings/factory', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ clientId, plugId }),

      });

      const result = await response.json();

      if (response.ok && result.success && result.deviceSynced === false) {

        // 設備未收到重置指令：畫面不可假裝已清除，繼電器與定時以設備實際狀態為準
        alert('MQTT 未連線，重置指令未送達設備；繼電器與定時設定未變更，請確認連線後再試。');

        return;

      }

      if (response.ok && result.success) {

        alert('設備設定已重置！');

        if (result.broadcast?.plugName) setDeviceName(result.broadcast.plugName);

        else fetchDeviceNameFromMqtt();

        setRelays(Array.from({ length: RELAY_COUNT }, (_, i) => ({

          id: i,

          name: `Relay ${i + 1}`,

          state: false,

        })));

        const cleared: Record<number, RelayTimerSlot[]> = {};

        for (let i = 0; i < RELAY_COUNT; i++) cleared[i] = defaultRelaySlots();

        setTimerByRelay(cleared);

        setTimerFlags(Array(RELAY_COUNT).fill(false));

      } else {

        throw new Error(result.error || '回復失敗');

      }

    } catch (error: unknown) {

      const message = error instanceof Error ? error.message : '未知錯誤';

      alert('重置設備設定失敗: ' + message);

    }

  };



  const handleEditName = async (id: number) => {

    const relay = relays.find((r) => r.id === id);

    if (!relay) return;

    const newName = prompt('更改開關名稱:', relay.name);

    if (newName !== null && newName.trim() !== '') {

      const trimmed = newName.trim();

      if (trimmed.length > 20) {

        alert('名稱過長！請限制在20個字元以內。');

        return;

      }

      try {

        const clientId = sessionStorage.getItem('mqttClientId');

        const response = await fetch('/api/relay/name', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify({ id, name: trimmed, clientId, plugId: sessionStorage.getItem('plugId') || '' }),

        });

        const result = await response.json();

        if (result.success) {

          setRelays((prev) => prev.map((r) => (r.id === id ? { ...r, name: trimmed } : r)));

        } else {

          throw new Error(result.error || '儲存失敗');

        }

      } catch (error: unknown) {

        const message = error instanceof Error ? error.message : '未知錯誤';

        alert('儲存名稱失敗：' + message);

      }

    }

  };



  const handleLogout = async () => {

    if (!confirm('確定要登出系統嗎?')) return;

    try {

      const clientId = sessionStorage.getItem('mqttClientId');

      const plugId = sessionStorage.getItem('plugId') || '';

      await fetch('/api/logout', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ clientId, plugId }),

      });

      wsRef.current?.close();

    } catch (error) {

      console.error('登出錯誤:', error);

    } finally {

      sessionStorage.removeItem('uiType');

      router.push('/');

    }

  };



  if (!pageReady) {

    return (

      <div className="min-h-screen bg-slate-100 flex items-center justify-center">

        <p className="text-slate-600 font-medium">載入定時操作面板…</p>

      </div>

    );

  }



  return (

    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-indigo-50/50 flex flex-col">

      {(deviceDate || deviceTime) && (
        <div
          className={`fixed top-3 left-3 z-50 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-bold shadow-md ${
            timerCapable ? 'bg-emerald-500 text-white' : 'bg-emerald-700 text-white'
          }`}
        >
          <span className={`w-2 h-2 rounded-full animate-pulse ${timerCapable ? 'bg-white' : 'bg-amber-300'}`} />
          {deviceDate} {deviceTime}
        </div>
      )}

      <div className="fixed top-3 right-3 z-50 flex flex-col items-end gap-1.5">

        <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 ${mqttConnected ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>

          <div className={`w-2 h-2 rounded-full bg-white ${mqttConnected ? 'animate-pulse' : ''}`} />

          {mqttConnected ? 'MQTT已連線' : 'MQTT已斷線'}

        </div>

        <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 ${

          deviceStatus === 'online' || deviceStatus === 'unknown' ? 'bg-indigo-500 text-white' : 'bg-red-600 text-white'

        }`}>

          {deviceStatus === 'online' || deviceStatus === 'unknown' ? '設備已連線' : '設備已離線'}

        </div>

      </div>



      {(deviceStatus === 'offline' || deviceStatus === 'reconnecting') && (

        <div className="fixed inset-0 z-40 bg-black/65 flex items-center justify-center px-6">

          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full">

            <h2 className="text-xl font-bold text-gray-800 mb-2">

              {deviceStatus === 'offline' ? '設備離線' : '設備同步中'}

            </h2>

            <p className="text-gray-500 text-sm">

              {deviceStatus === 'reconnecting'

                ? '正在同步時間與繼電器狀態，請稍候…'

                : '請稍候…'}

            </p>

          </div>

        </div>

      )}



      {saveError && (

        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium shadow-lg max-w-md text-center">

          {saveError}

        </div>

      )}



      {!timerCapable && deviceStatus !== 'offline' && deviceStatus !== 'reconnecting' && (

        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium shadow-lg max-w-md text-center">

          設備時間未同步，定時功能暫停。手動開關仍可使用，請檢查設備端網路。

        </div>

      )}



      <div className="flex-1 p-4 pb-28 overflow-y-auto">

        <div className="max-w-4xl mx-auto mb-6 text-center">

          <h2 className="text-2xl font-bold text-slate-800 mb-2">定時遠控面板</h2>

          <div className="inline-block bg-white rounded-xl shadow-sm border border-slate-200/80 px-5 py-3 min-w-[220px]">

            <p className="text-xs text-slate-500 mb-0.5">設備名稱</p>

            <p className="text-lg font-semibold text-slate-800">{deviceName}</p>

          </div>

        </div>



        <div className="grid grid-cols-2 gap-3 md:gap-4 max-w-3xl mx-auto">

          {relays.map((relay) => (

            <div

              key={relay.id}

              className={`bg-white rounded-2xl shadow-md border border-slate-100 p-4 flex flex-col items-center gap-3 transition-all ${isDeviceReady ? 'hover:shadow-lg' : 'opacity-50'}`}

            >

              <div className="flex items-center gap-2">

                <div className="font-bold text-slate-800 text-center text-sm md:text-base">{relay.name}</div>

                {timerFlags[relay.id] && (

                  <span

                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-xs"

                    title="已設定定時"

                    aria-label="已設定定時"

                  >

                    ⏱

                  </span>

                )}

              </div>

              <div className="flex items-center gap-2 flex-wrap justify-center w-full">

                <div className={`checkbox-wrapper-25 ${!isDeviceReady ? 'pointer-events-none' : ''}`}>

                  <input

                    type="checkbox"

                    checked={relay.state}

                    onChange={(e) => toggleRelay(relay.id, e.target.checked)}

                    id={`switch-timer-${relay.id}`}

                    disabled={!isDeviceReady}

                  />

                  <label htmlFor={`switch-timer-${relay.id}`} className={isDeviceReady ? 'cursor-pointer' : 'cursor-not-allowed'} />

                </div>

                <button

                  type="button"

                  onClick={() => openTimerSettings(relay.id)}

                  disabled={!isDeviceReady}

                  className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition-all disabled:opacity-50"

                >

                  定時

                </button>

                <button

                  type="button"

                  onClick={() => handleEditName(relay.id)}

                  disabled={!isDeviceReady}

                  className="bg-sky-400 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md disabled:opacity-50"

                >

                  修改

                </button>

              </div>

            </div>

          ))}

        </div>

      </div>



      {timerModalRelay !== null && (

        <TimerSettingsModal

          relayId={timerModalRelay}

          relayName={relays.find((r) => r.id === timerModalRelay)?.name || `Relay ${timerModalRelay + 1}`}

          slots={timerByRelay[timerModalRelay] || defaultRelaySlots()}

          deviceDate={deviceDate}

          deviceTime={deviceTime}

          onClose={() => setTimerModalRelay(null)}

          onSaveRelay={(slots) => saveRelayTimers(timerModalRelay, slots)}

        />

      )}



      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-r from-indigo-700 to-violet-700 shadow-lg p-4">

        <div className="max-w-4xl mx-auto grid grid-cols-2 gap-3">

          <button

            type="button"

            onClick={handleResetSettings}

            className="px-3 py-3 rounded-xl font-bold text-xs md:text-sm bg-transparent text-white border-2 border-amber-300 hover:bg-amber-500/20"

          >

            重置設備設定

          </button>

          <button

            type="button"

            onClick={handleLogout}

            className="px-3 py-3 rounded-xl font-bold text-xs md:text-sm bg-transparent text-white border-2 border-white hover:bg-white/10"

          >

            登出

          </button>

        </div>

      </div>

    </div>

  );

}



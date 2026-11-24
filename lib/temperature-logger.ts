/**
 * 溫度記錄服務
 * 每半小時為每台設備（PlugID）各記錄一筆溫度到 data/temperature/{plugId}/{星期}.txt
 */

import fs from 'fs/promises';
import path from 'path';
import { getNTPTime, formatTemperatureTimestamp, getDayOfWeekFileName, isSameDay } from './ntp-client';

// 檔案儲存目錄（每台設備一個子目錄）
const DATA_DIR = path.join(process.cwd(), 'data', 'temperature');

// 星期檔案列表
export const WEEKDAY_FILES = [
  'Sunday.txt',
  'Monday.txt',
  'Tuesday.txt',
  'Wednesday.txt',
  'Thursday.txt',
  'Friday.txt',
  'Saturday.txt'
];

/** PlugID 會組成檔案路徑：只允許英數字，防止路徑穿越 */
export function isValidPlugId(plugId: unknown): plugId is string {
  return typeof plugId === 'string' && /^[A-Za-z0-9]{1,64}$/.test(plugId);
}

function plugDir(plugId: string): string {
  return path.join(DATA_DIR, plugId);
}

type PlugRecordState = {
  lastRecordTime: Date | null;
  lastTemperature: number | null;
};

// 每台設備的最後記錄
const plugRecordStates = new Map<string, PlugRecordState>();

function getPlugRecordState(plugId: string): PlugRecordState {
  let s = plugRecordStates.get(plugId);
  if (!s) {
    s = { lastRecordTime: null, lastTemperature: null };
    plugRecordStates.set(plugId, s);
  }
  return s;
}

// 記錄器狀態
let loggerActive = false;
let intervalId: NodeJS.Timeout | null = null;
let configuredIntervalMinutes = 30;

export type MqttRecordingState = {
  valid: boolean;
  reason: string | null;
  connectedCount: number;
  lastMqttTemperatureAt: number | null;
};

export type TemperatureRecordingContext = {
  /** 指定設備目前是否有有效（未逾時）的 MQTT 溫度 */
  getRecordingState?: (plugId: string) => MqttRecordingState;
  /** 目前有收到溫度的設備清單 */
  listPlugIds?: () => string[];
  /** 指定設備的最新溫度 */
  getTemperature?: (plugId: string) => number | null;
};

let recordingContext: TemperatureRecordingContext = {};

const PAUSE_REASON_TEXT: Record<string, string> = {
  no_mqtt_connection: '無 MQTT 連線，暫停寫入',
  no_temperature_data: '尚未收到 MQTT 溫度資料，暫停寫入',
  stale_temperature: 'MQTT 溫度資料逾時，暫停寫入',
  invalid_plug_id: '缺少或無效的 PlugID',
};

export function setTemperatureRecordingContext(context: TemperatureRecordingContext): void {
  recordingContext = context;
}

function getPauseReasonText(reason: string | null): string | null {
  if (!reason) return null;
  return PAUSE_REASON_TEXT[reason] ?? reason;
}

/**
 * 初始化溫度記錄服務
 */
export async function initTemperatureLogger(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('📝 溫度記錄服務初始化完成（依 PlugID 分目錄）');
  } catch (error) {
    console.error('❌ 溫度記錄服務初始化失敗:', error);
    throw error;
  }
}

/**
 * 初始化某台設備的星期檔案（如果不存在）
 */
async function initWeekdayFiles(plugId: string): Promise<void> {
  const dir = plugDir(plugId);
  await fs.mkdir(dir, { recursive: true });
  for (const filename of WEEKDAY_FILES) {
    const filePath = path.join(dir, filename);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, createFileHeader(plugId, filename));
      console.log(`📄 已創建溫度記錄檔案: ${plugId}/${filename}`);
    }
  }
}

/**
 * 創建檔案標題
 */
function createFileHeader(plugId: string, filename: string): string {
  const dayName = filename.replace('.txt', '');
  return `溫度記錄 - ${plugId} - ${dayName}\n${'='.repeat(50)}\n`;
}

/**
 * 開始溫度記錄（每個週期為所有有效設備各記錄一筆）
 * @param intervalMinutes 記錄間隔（分鐘）
 */
export function startTemperatureLogging(intervalMinutes: number = 30): void {
  if (loggerActive) {
    console.warn('⚠️  溫度記錄服務已在運行中');
    return;
  }

  loggerActive = true;
  configuredIntervalMinutes = intervalMinutes;

  recordAllPlugs().catch(error => {
    console.error('❌ 初始溫度記錄失敗:', error);
  });

  intervalId = setInterval(async () => {
    await recordAllPlugs();
  }, intervalMinutes * 60 * 1000);

  console.log(`📝 溫度記錄服務已啟動（每 ${intervalMinutes} 分鐘記錄一次）`);
}

/**
 * 停止溫度記錄
 */
export function stopTemperatureLogging(): void {
  if (!loggerActive) return;

  loggerActive = false;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  console.log('📝 溫度記錄服務已停止');
}

async function recordAllPlugs(): Promise<void> {
  const plugIds = (recordingContext.listPlugIds?.() ?? []).filter(isValidPlugId);
  if (plugIds.length === 0) {
    console.log('⏸️ 溫度記錄暫停：尚無任何設備的 MQTT 溫度資料');
    return;
  }
  for (const plugId of plugIds) {
    await recordTemperature(plugId);
  }
}

/**
 * 記錄單一設備的溫度數據
 */
async function recordTemperature(plugId: string): Promise<void> {
  try {
    const mqttState = recordingContext.getRecordingState?.(plugId);
    if (!mqttState?.valid) {
      console.log(`⏸️ [${plugId}] 溫度記錄暫停：${getPauseReasonText(mqttState?.reason ?? 'no_mqtt_connection')}`);
      return;
    }

    const state = getPlugRecordState(plugId);
    const currentTime = await getNTPTime();

    // 避免短時間內重複記錄
    if (state.lastRecordTime && (currentTime.getTime() - state.lastRecordTime.getTime()) < 25 * 60 * 1000) {
      return;
    }

    const temperature = recordingContext.getTemperature?.(plugId);
    if (typeof temperature !== 'number' || isNaN(temperature)) {
      throw new Error(`無效的溫度數據: ${temperature}`);
    }

    const timestamp = formatTemperatureTimestamp(currentTime);
    const recordLine = `${timestamp}${temperature.toFixed(1)}°C`;

    await initWeekdayFiles(plugId);
    const filename = getDayOfWeekFileName(currentTime);
    const filePath = path.join(plugDir(plugId), filename);

    await manageFileRotation(plugId, filePath, filename, currentTime);
    await fs.appendFile(filePath, recordLine + '\n', 'utf-8');

    state.lastRecordTime = currentTime;
    state.lastTemperature = temperature;

    console.log(`📝 [${plugId}] 溫度記錄成功: ${recordLine} → ${filename}`);
  } catch (error) {
    console.error(`❌ [${plugId}] 溫度記錄失敗:`, error);
  }
}

/**
 * 管理檔案循環（新的一天時清空舊內容）
 */
async function manageFileRotation(plugId: string, filePath: string, filename: string, currentTime: Date): Promise<void> {
  try {
    const fileStats = await fs.stat(filePath);
    const fileModifiedTime = new Date(fileStats.mtime);
    if (!isSameDay(fileModifiedTime, currentTime)) {
      await fs.writeFile(filePath, createFileHeader(plugId, filename), 'utf-8');
      console.log(`🔄 [${plugId}] 新的一天開始，已清空檔案: ${filename}`);
    }
  } catch {
    await fs.writeFile(filePath, createFileHeader(plugId, filename), 'utf-8');
  }
}

/** 指定設備、指定星期檔的完整路徑；參數無效時回傳 null */
export function resolveLogFilePath(plugId: string, filename: string): string | null {
  if (!isValidPlugId(plugId) || !WEEKDAY_FILES.includes(filename)) return null;
  return path.join(plugDir(plugId), filename);
}

/**
 * 獲取指定設備、指定檔案的溫度記錄
 */
export async function getTemperatureRecords(plugId: string, filename: string): Promise<string[]> {
  const filePath = resolveLogFilePath(plugId, filename);
  if (!filePath) return [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.split('\n').filter(line => {
      return line.trim() !== '' &&
             !line.startsWith('溫度記錄 - ') &&
             !line.startsWith('=');
    });
  } catch {
    return [];
  }
}

/**
 * 獲取指定設備的溫度記錄檔案列表（固定七個星期檔）
 */
export async function getAvailableLogFiles(plugId: string): Promise<string[]> {
  if (!isValidPlugId(plugId)) return [];
  return [...WEEKDAY_FILES];
}

/**
 * 獲取指定設備的今日溫度記錄
 */
export async function getTodayTemperatureRecords(plugId: string): Promise<string[]> {
  try {
    const currentTime = await getNTPTime();
    const filename = getDayOfWeekFileName(currentTime);
    return await getTemperatureRecords(plugId, filename);
  } catch (error) {
    console.error('❌ 獲取今日溫度記錄失敗:', error);
    return [];
  }
}

/**
 * 獲取指定設備的記錄器狀態
 */
export function getLoggerStatus(plugId?: string): {
  active: boolean;
  recordingPaused: boolean;
  pauseReason: string | null;
  pauseReasonText: string | null;
  lastRecordTime: string | null;
  lastTemperature: number | null;
  intervalMinutes: number;
  mqttConnectedCount: number;
  lastMqttTemperatureAt: string | null;
} {
  const validPlug = isValidPlugId(plugId);
  const mqttState = validPlug ? recordingContext.getRecordingState?.(plugId) : undefined;
  const state = validPlug ? plugRecordStates.get(plugId) : undefined;

  let pauseReason: string | null = null;
  if (!validPlug) pauseReason = 'invalid_plug_id';
  else if (!mqttState) pauseReason = 'no_mqtt_connection';
  else if (!mqttState.valid) pauseReason = mqttState.reason;

  return {
    active: loggerActive,
    recordingPaused: !loggerActive || pauseReason !== null,
    pauseReason,
    pauseReasonText: getPauseReasonText(pauseReason),
    lastRecordTime: state?.lastRecordTime ? state.lastRecordTime.toISOString() : null,
    lastTemperature: state?.lastTemperature ?? null,
    intervalMinutes: loggerActive ? configuredIntervalMinutes : 0,
    mqttConnectedCount: mqttState?.connectedCount ?? 0,
    lastMqttTemperatureAt: mqttState?.lastMqttTemperatureAt
      ? new Date(mqttState.lastMqttTemperatureAt).toISOString()
      : null,
  };
}

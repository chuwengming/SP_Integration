"use strict";
/**
 * 溫度記錄服務
 * 每半小時為每台設備（PlugID）各記錄一筆溫度到 data/temperature/{plugId}/{星期}.txt
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKDAY_FILES = void 0;
exports.isValidPlugId = isValidPlugId;
exports.setTemperatureRecordingContext = setTemperatureRecordingContext;
exports.initTemperatureLogger = initTemperatureLogger;
exports.startTemperatureLogging = startTemperatureLogging;
exports.stopTemperatureLogging = stopTemperatureLogging;
exports.resolveLogFilePath = resolveLogFilePath;
exports.getTemperatureRecords = getTemperatureRecords;
exports.getAvailableLogFiles = getAvailableLogFiles;
exports.getTodayTemperatureRecords = getTodayTemperatureRecords;
exports.getLoggerStatus = getLoggerStatus;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const ntp_client_1 = require("./ntp-client");
// 檔案儲存目錄（每台設備一個子目錄）
const DATA_DIR = path_1.default.join(process.cwd(), 'data', 'temperature');
// 星期檔案列表
exports.WEEKDAY_FILES = [
    'Sunday.txt',
    'Monday.txt',
    'Tuesday.txt',
    'Wednesday.txt',
    'Thursday.txt',
    'Friday.txt',
    'Saturday.txt'
];
/** PlugID 會組成檔案路徑：只允許英數字，防止路徑穿越 */
function isValidPlugId(plugId) {
    return typeof plugId === 'string' && /^[A-Za-z0-9]{1,64}$/.test(plugId);
}
function plugDir(plugId) {
    return path_1.default.join(DATA_DIR, plugId);
}
// 每台設備的最後記錄
const plugRecordStates = new Map();
function getPlugRecordState(plugId) {
    let s = plugRecordStates.get(plugId);
    if (!s) {
        s = { lastRecordTime: null, lastTemperature: null };
        plugRecordStates.set(plugId, s);
    }
    return s;
}
// 記錄器狀態
let loggerActive = false;
let intervalId = null;
let configuredIntervalMinutes = 30;
let recordingContext = {};
const PAUSE_REASON_TEXT = {
    no_mqtt_connection: '無 MQTT 連線，暫停寫入',
    no_temperature_data: '尚未收到 MQTT 溫度資料，暫停寫入',
    stale_temperature: 'MQTT 溫度資料逾時，暫停寫入',
    invalid_plug_id: '缺少或無效的 PlugID',
};
function setTemperatureRecordingContext(context) {
    recordingContext = context;
}
function getPauseReasonText(reason) {
    var _a;
    if (!reason)
        return null;
    return (_a = PAUSE_REASON_TEXT[reason]) !== null && _a !== void 0 ? _a : reason;
}
/**
 * 初始化溫度記錄服務
 */
async function initTemperatureLogger() {
    try {
        await promises_1.default.mkdir(DATA_DIR, { recursive: true });
        console.log('📝 溫度記錄服務初始化完成（依 PlugID 分目錄）');
    }
    catch (error) {
        console.error('❌ 溫度記錄服務初始化失敗:', error);
        throw error;
    }
}
/**
 * 初始化某台設備的星期檔案（如果不存在）
 */
async function initWeekdayFiles(plugId) {
    const dir = plugDir(plugId);
    await promises_1.default.mkdir(dir, { recursive: true });
    for (const filename of exports.WEEKDAY_FILES) {
        const filePath = path_1.default.join(dir, filename);
        try {
            await promises_1.default.access(filePath);
        }
        catch {
            await promises_1.default.writeFile(filePath, createFileHeader(plugId, filename));
            console.log(`📄 已創建溫度記錄檔案: ${plugId}/${filename}`);
        }
    }
}
/**
 * 創建檔案標題
 */
function createFileHeader(plugId, filename) {
    const dayName = filename.replace('.txt', '');
    return `溫度記錄 - ${plugId} - ${dayName}\n${'='.repeat(50)}\n`;
}
/**
 * 開始溫度記錄（每個週期為所有有效設備各記錄一筆）
 * @param intervalMinutes 記錄間隔（分鐘）
 */
function startTemperatureLogging(intervalMinutes = 30) {
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
function stopTemperatureLogging() {
    if (!loggerActive)
        return;
    loggerActive = false;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    console.log('📝 溫度記錄服務已停止');
}
async function recordAllPlugs() {
    var _a, _b;
    const plugIds = ((_b = (_a = recordingContext.listPlugIds) === null || _a === void 0 ? void 0 : _a.call(recordingContext)) !== null && _b !== void 0 ? _b : []).filter(isValidPlugId);
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
async function recordTemperature(plugId) {
    var _a, _b, _c;
    try {
        const mqttState = (_a = recordingContext.getRecordingState) === null || _a === void 0 ? void 0 : _a.call(recordingContext, plugId);
        if (!(mqttState === null || mqttState === void 0 ? void 0 : mqttState.valid)) {
            console.log(`⏸️ [${plugId}] 溫度記錄暫停：${getPauseReasonText((_b = mqttState === null || mqttState === void 0 ? void 0 : mqttState.reason) !== null && _b !== void 0 ? _b : 'no_mqtt_connection')}`);
            return;
        }
        const state = getPlugRecordState(plugId);
        const currentTime = await (0, ntp_client_1.getNTPTime)();
        // 避免短時間內重複記錄
        if (state.lastRecordTime && (currentTime.getTime() - state.lastRecordTime.getTime()) < 25 * 60 * 1000) {
            return;
        }
        const temperature = (_c = recordingContext.getTemperature) === null || _c === void 0 ? void 0 : _c.call(recordingContext, plugId);
        if (typeof temperature !== 'number' || isNaN(temperature)) {
            throw new Error(`無效的溫度數據: ${temperature}`);
        }
        const timestamp = (0, ntp_client_1.formatTemperatureTimestamp)(currentTime);
        const recordLine = `${timestamp}${temperature.toFixed(1)}°C`;
        await initWeekdayFiles(plugId);
        const filename = (0, ntp_client_1.getDayOfWeekFileName)(currentTime);
        const filePath = path_1.default.join(plugDir(plugId), filename);
        await manageFileRotation(plugId, filePath, filename, currentTime);
        await promises_1.default.appendFile(filePath, recordLine + '\n', 'utf-8');
        state.lastRecordTime = currentTime;
        state.lastTemperature = temperature;
        console.log(`📝 [${plugId}] 溫度記錄成功: ${recordLine} → ${filename}`);
    }
    catch (error) {
        console.error(`❌ [${plugId}] 溫度記錄失敗:`, error);
    }
}
/**
 * 管理檔案循環（新的一天時清空舊內容）
 */
async function manageFileRotation(plugId, filePath, filename, currentTime) {
    try {
        const fileStats = await promises_1.default.stat(filePath);
        const fileModifiedTime = new Date(fileStats.mtime);
        if (!(0, ntp_client_1.isSameDay)(fileModifiedTime, currentTime)) {
            await promises_1.default.writeFile(filePath, createFileHeader(plugId, filename), 'utf-8');
            console.log(`🔄 [${plugId}] 新的一天開始，已清空檔案: ${filename}`);
        }
    }
    catch {
        await promises_1.default.writeFile(filePath, createFileHeader(plugId, filename), 'utf-8');
    }
}
/** 指定設備、指定星期檔的完整路徑；參數無效時回傳 null */
function resolveLogFilePath(plugId, filename) {
    if (!isValidPlugId(plugId) || !exports.WEEKDAY_FILES.includes(filename))
        return null;
    return path_1.default.join(plugDir(plugId), filename);
}
/**
 * 獲取指定設備、指定檔案的溫度記錄
 */
async function getTemperatureRecords(plugId, filename) {
    const filePath = resolveLogFilePath(plugId, filename);
    if (!filePath)
        return [];
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        return content.split('\n').filter(line => {
            return line.trim() !== '' &&
                !line.startsWith('溫度記錄 - ') &&
                !line.startsWith('=');
        });
    }
    catch {
        return [];
    }
}
/**
 * 獲取指定設備的溫度記錄檔案列表（固定七個星期檔）
 */
async function getAvailableLogFiles(plugId) {
    if (!isValidPlugId(plugId))
        return [];
    return [...exports.WEEKDAY_FILES];
}
/**
 * 獲取指定設備的今日溫度記錄
 */
async function getTodayTemperatureRecords(plugId) {
    try {
        const currentTime = await (0, ntp_client_1.getNTPTime)();
        const filename = (0, ntp_client_1.getDayOfWeekFileName)(currentTime);
        return await getTemperatureRecords(plugId, filename);
    }
    catch (error) {
        console.error('❌ 獲取今日溫度記錄失敗:', error);
        return [];
    }
}
/**
 * 獲取指定設備的記錄器狀態
 */
function getLoggerStatus(plugId) {
    var _a, _b, _c;
    const validPlug = isValidPlugId(plugId);
    const mqttState = validPlug ? (_a = recordingContext.getRecordingState) === null || _a === void 0 ? void 0 : _a.call(recordingContext, plugId) : undefined;
    const state = validPlug ? plugRecordStates.get(plugId) : undefined;
    let pauseReason = null;
    if (!validPlug)
        pauseReason = 'invalid_plug_id';
    else if (!mqttState)
        pauseReason = 'no_mqtt_connection';
    else if (!mqttState.valid)
        pauseReason = mqttState.reason;
    return {
        active: loggerActive,
        recordingPaused: !loggerActive || pauseReason !== null,
        pauseReason,
        pauseReasonText: getPauseReasonText(pauseReason),
        lastRecordTime: (state === null || state === void 0 ? void 0 : state.lastRecordTime) ? state.lastRecordTime.toISOString() : null,
        lastTemperature: (_b = state === null || state === void 0 ? void 0 : state.lastTemperature) !== null && _b !== void 0 ? _b : null,
        intervalMinutes: loggerActive ? configuredIntervalMinutes : 0,
        mqttConnectedCount: (_c = mqttState === null || mqttState === void 0 ? void 0 : mqttState.connectedCount) !== null && _c !== void 0 ? _c : 0,
        lastMqttTemperatureAt: (mqttState === null || mqttState === void 0 ? void 0 : mqttState.lastMqttTemperatureAt)
            ? new Date(mqttState.lastMqttTemperatureAt).toISOString()
            : null,
    };
}

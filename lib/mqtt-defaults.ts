/**
 * 全專案共用的 MQTT Broker 參數。
 * 連線身分：ESP Broker ClientID = plugId；Next = plugId_sessionClientId（見 mqtt-shared.js）
 * - ESP32 Broker ClientID = plugId
 * - Next.js Broker ClientID = plugId_sessionClientId（sessionClientId = 登入頁 Client ID）
 */
export const MQTT_DEFAULTS = {
    broker: 'w1a7a47a.ala.asia-southeast1.emqxsl.com',
    port: '8883',
    username: 'moonstar',
    password: 'moonstar9926ej@Hs',
} as const;

export const DEFAULT_DEVICE_LOGIN_PASSWORD = '123456';

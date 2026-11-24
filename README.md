# 操作面板 (Operation Panel) 設定說明

## 📁 專案的檔案結構

smartplug/
├── app/
│   ├── page.tsx
│   ├── operation/
│   │   └── page.tsx
│   ├── api/
│   │   ├── relay/
│   │   │   └── name/
│   │   │       └── route.ts
│   │   ├── logout/
│   │   │     └── route.ts
│   │   ├── mqtt/
│   │   │   ├── connect/
│   │   │   │   └── route.ts
│   │   │   └── status/
│   │   │       └── route.ts 
│   │   ├── plugName/
│   │   │   └── route.ts 
│   │   ├── voltage/
│   │   │   └── route.ts 
│   │   └── login/
│   │       └── route.ts
│   ├── globals.css
│   └── layout.tsx
├── lib/
│   └── mqtt.ts
│   └── mqtt-operation.ts
├── public/
├── .env.local
├── .env.local.example
├── package.json
├── tsconfig.json
├── next.config.ts
├── server.js
└── README_SETUP.md

## 🎯 操作面板功能說明

### 主頁面功能
1. **繼電器控制區**
   - 6 個繼電器卡片
   - 每個卡片包含：
     - 繼電器名稱（可自訂）
     - 開關切換器（左=開，右=關）
     - 點動按鈕（開啟 1 秒後自動關閉）
     - 修改按鈕（修改繼電器名稱）

2. **溫度顯示區**
   - 顯示當前溫度
   - 每 2 秒透過 MQTT 更新

3. **底部導航欄**
   - 主頁面：返回主控制頁
   - 溫度記錄：查看溫度歷史（尚待開發）
   - 系統設定：MQTT及設備名稱設定
   - 登出：返回登入頁面

### WebSocket 連線狀態
- 右上角顯示連線狀態
- 綠色：已連線
- 紅色：已斷線
- 自動重連機制（5 秒後）

## 📡 MQTT 主題設計

所有主題都必須包含 PlugID；Client 專屬命令另包含 ClientID。

### 設備公播／狀態主題
| 主題 | 說明 |
|------|------|
| `smartplug/{plugId}/announce` | Client 宣告 |
| `smartplug/{plugId}/temperature` | 溫度 |
| `smartplug/{plugId}/voltage` | 電壓 |
| `smartplug/{plugId}/plugName` | 插座名稱 |
| `smartplug/{plugId}/relay/state` | 繼電器狀態 |
| `smartplug/{plugId}/relay/name` | 繼電器名稱 |
| `smartplug/{plugId}/live` | 設備存活狀態 |

### Client 專屬命令主題
| 主題 | 說明 |
|------|------|
| `smartplug/{plugId}/{clientId}/announce` | announce 回應 |
| `smartplug/{plugId}/{clientId}/control` | 繼電器控制 |
| `smartplug/{plugId}/{clientId}/name` | 繼電器名稱更新 |
| `smartplug/{plugId}/{clientId}/plugName` | 插座名稱更新 |
| `smartplug/{plugId}/{clientId}/request` | 狀態請求 |
| `smartplug/{plugId}/{clientId}/offline` | Client 離線通知 |

### Timer 專屬主題
| 主題 | 說明 |
|------|------|
| `smartplug/{plugId}/deviceTime` | 設備時間 |
| `smartplug/{plugId}/{clientId}/timer` | 定時讀寫命令 |
| `smartplug/{plugId}/{clientId}/timer/response` | 定時命令回應 |
| `smartplug/{plugId}/timer` | 定時設定公播 |
| `smartplug/{plugId}/timerFlags` | 各 Relay 定時旗標 |
| `smartplug/{plugId}/timer/conflict` | 定時衝突 |
| `smartplug/{plugId}/syncReady` | Timer 啟動同步完成 |

程式碼權威來源為 `lib/mqtt.ts`、`server.js` 及兩份韌體的
`include/mqtt_manager.h`；修改主題時必須同步三端。

## 🎨 響應式設計

### 桌面（> 768px）
- 繼電器：3 行 × 2 列
- 底部導航：橫向排列
- 卡片間距：16px

### 平板（481px - 768px）
- 繼電器：3 行 × 2 列
- 底部導航：橫向排列
- 卡片間距：12px

### 手機（< 480px）
- 繼電器：3 行 × 2 列
- 底部導航：橫向排列（較小字體）
- 卡片間距：8px
- 按鈕文字縮小

### 滑動限制
- ✅ 允許上下滑動（overflow-y: auto）
- ❌ 禁止左右滑動（overflow-x: hidden）

## 🧪 測試建議

### 1. WebSocket 連線測試

在瀏覽器控制台測試：

```javascript
const ws = new WebSocket('ws://localhost:3000/api/ws/operation');
ws.onopen = () => console.log('WebSocket 已連線');
ws.onmessage = (e) => console.log('收到訊息:', e.data);
ws.send(JSON.stringify({ command: 'get_sensors' }));
```

### 2. MQTT 模擬測試

使用 MQTTX 或其他 MQTT 客戶端：

1. 連接到相同的 MQTT Broker
2. 訂閱 `smartplug/{plugId}/#`
3. 發布到 `smartplug/{plugId}/temperature`：
   ```json
   {"temperature": 26.8}
   ```
4. 發布到 `smartplug/{plugId}/relay/state`：
   ```json
   {"id": 0, "state": true}
   ```

### 3. 功能測試清單

- [ ] 繼電器開關切換
- [ ] 點動功能（1 秒脈衝）
- [ ] 修改繼電器名稱
- [ ] 溫度即時更新
- [ ] WebSocket 自動重連
- [ ] 登出功能
- [ ] 響應式佈局（手機/平板/桌面）

## ⚠️ 注意事項

### WebSocket 設定

Next.js App Router 不原生支援 WebSocket，因此：
1. 使用 Pages Router (`pages/api/ws/operation.ts`)
2. 確保該檔案位於 `pages/api` 目錄下
3. WebSocket 端點：`ws://localhost:3000/api/ws/operation`

### MQTT 連線管理

1. **登入頁面**連線 MQTT → 儲存客戶端實例
2. **操作頁面**使用相同的 MQTT 連線
3. **登出時**斷開 MQTT 連線

### 效能優化

1. 溫度更新頻率：2 秒（避免過於頻繁）
2. WebSocket 心跳：30 秒 ping/pong
3. MQTT QoS：建議使用 QoS 1（至少一次傳遞）

## 🐛 疑難排解

### WebSocket 連線失敗

1. 確認 `pages/api/ws/operation.ts` 檔案存在
2. 檢查瀏覽器控制台錯誤訊息
3. 確認沒有防火牆阻擋

### MQTT 訊息未收到

1. 檢查 MQTT Broker 連線狀態
2. 確認主題名稱正確
3. 查看伺服器控制台日誌

### 繼電器狀態不同步

1. 確認 ESP32 有正確回報狀態
2. 檢查 MQTT 主題訂閱
3. 查看 WebSocket 訊息是否正常廣播

## 📞 後續開發

- [ ] 溫度記錄頁面
- [ ] 系統設定頁面
- [ ] 定時器功能
- [ ] 場景模式
- [ ] 歷史數據圖表

## 🔗 相關文件

- [MQTT.js 文件](https://github.com/mqttjs/MQTT.js)
- [ws 套件文件](https://github.com/websockets/ws)
- [Next.js API Routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes)

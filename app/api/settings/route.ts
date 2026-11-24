import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { publishMqtt, MqttTopics } from '@/lib/mqtt';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'setting.json');

// 讀取設定
export async function GET() {
    try {
        const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
        const settings = JSON.parse(data);
        return NextResponse.json(settings);
    } catch (error) {
        console.error('讀取設定檔案失敗:', error);
        return NextResponse.json(
            { error: '無法讀取設定檔案' },
            { status: 500 }
        );
    }
}

// 更新設定
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // 驗證必要的欄位
        if (!body.mqtt || !body.mqtt.broker || !body.mqtt.port || !body.mqtt.clientId) {
            return NextResponse.json(
                { error: '缺少必要的設定欄位' },
                { status: 400 }
            );
        }

        // 讀取現有設定以檢查插座名稱是否有變化
        const existingData = JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf-8'));
        const oldPlugName = existingData.plugName || 'SmartPlug';
        const newPlugName = body.plugName || 'SmartPlug';
        const plugId = body.plugId || existingData.plugId || 'defaultPlug';

        // 保留原有的 loginPassword 如果沒有提供（空白表示不修改）
        if (!body.loginPassword) {
            body.loginPassword = existingData.loginPassword;
        }

        // 寫入檔案
        await fs.writeFile(SETTINGS_PATH, JSON.stringify(body, null, 4), 'utf-8');

        // 同時複製到 public/data/setting.json 以供前端讀取
        const publicPath = path.join(process.cwd(), 'public', 'data', 'setting.json');
        await fs.writeFile(publicPath, JSON.stringify(body, null, 4), 'utf-8');

        // 插座名稱以 ESP32 NVS 為權威：送到設備指令主題，由 ESP32 儲存後廣播 smartplug/{plugId}/plugName 給所有 Client
        if (oldPlugName !== newPlugName && newPlugName.trim() !== '') {
            const topic = MqttTopics.plugNameTopic(plugId, body.mqtt.clientId);
            const payload = JSON.stringify({ plugName: newPlugName });

            const sent = publishMqtt(topic, payload, { qos: 1 }, body.mqtt.clientId);

            if (sent) {
                console.log(`📤 已送出插座名稱至 ESP32: ${newPlugName} (PlugID: ${plugId})`);
            } else {
                console.warn(`⚠️  插座名稱未送達 ESP32，可能 MQTT 未連線`);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('儲存設定檔案失敗:', error);
        return NextResponse.json(
            { error: '儲存設定失敗' },
            { status: 500 }
        );
    }
}

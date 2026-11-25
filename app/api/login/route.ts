import { NextRequest, NextResponse } from 'next/server';
import { getMqttStatus } from '@/lib/mqtt';
import { lookupPlugForLogin } from '@/lib/registry-db';
import { getOperationRoute } from '@/lib/ui-type';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password, clientId, plugId } = body;

    if (!getMqttStatus(clientId)) {
      return NextResponse.json(
        { message: 'MQTT 未連線，無法登入 (Client: ' + (clientId || 'Unknown') + ')' },
        { status: 503 }
      );
    }

    if (!password) {
      return NextResponse.json({ message: '請輸入密碼' }, { status: 400 });
    }

    if (!plugId) {
      return NextResponse.json({ message: '缺少 PlugID，請重新連線 MQTT' }, { status: 400 });
    }

    console.log(`收到登入請求 (Client: ${clientId}, Plug: ${plugId})`);

    const lookup = await lookupPlugForLogin(String(plugId));

    if (lookup.status === 'no_database') {
      console.warn(`❌ 登入拒絕：中央註冊資料庫未連線 (Plug: ${plugId})`);
      return NextResponse.json(
        { message: '中央註冊資料庫未連線，無法登入' },
        { status: 503 }
      );
    }

    if (lookup.status === 'not_registered') {
      console.warn(`❌ 登入拒絕：PlugID 未在中央註冊 (Plug: ${plugId})`);
      return NextResponse.json(
        { message: '此 PlugID 未在中央註冊，無法登入。請先完成設備配號。' },
        { status: 403 }
      );
    }

    if (password !== lookup.loginPassword) {
      console.log('❌ 密碼驗證失敗');
      return NextResponse.json(
        { message: '密碼錯誤，請重新輸入。' },
        { status: 401 }
      );
    }

    const uiType = lookup.uiType;
    console.log(`✅ 密碼驗證成功（中央註冊資料庫），uiType=${uiType}`);
    return NextResponse.json({
      success: true,
      message: '登入成功',
      uiType,
      operationRoute: getOperationRoute(uiType),
    });
  } catch (error: any) {
    console.error('登入錯誤:', error);
    return NextResponse.json(
      { message: '登入失敗，請稍後再試。' },
      { status: 500 }
    );
  }
}

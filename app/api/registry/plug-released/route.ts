import { NextRequest } from 'next/server';
import { releasePlugOnFactoryReset } from '@/lib/registry-db';
import { registryJsonResponse, registryOptionsResponse } from '@/lib/registry-cors';

/**
 * POST /api/registry/plug-released
 * Body: { factorySerial?: string, plugId?: string }
 * ESP32 原廠重置：registered=No，且 login_password 回復預設 123456。
 * 優先 factorySerial；若無出廠編號可用 plugId。
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const factorySerial = (body?.factorySerial as string | undefined)?.trim() || '';
        const plugId = (body?.plugId as string | undefined)?.trim() || '';

        if (!factorySerial && !plugId) {
            return registryJsonResponse(
                request,
                { success: false, error: 'MISSING_SERIAL_OR_PLUG_ID' },
                400
            );
        }

        const released = await releasePlugOnFactoryReset({ factorySerial, plugId });

        if (released === 'no_database') {
            return registryJsonResponse(
                request,
                { success: false, error: 'DATABASE_UNAVAILABLE' },
                503
            );
        }

        if (released === 'not_found') {
            return registryJsonResponse(
                request,
                { success: false, error: 'UNKNOWN_DEVICE' },
                404
            );
        }

        console.log(
            `✅ [Registry] 原廠重置釋放：registered=No、密碼已重設` +
                (factorySerial ? ` serial=${factorySerial}` : '') +
                (plugId ? ` plugId=${plugId}` : '')
        );

        return registryJsonResponse(request, { success: true }, 200);
    } catch (error: any) {
        console.error('❌ [Registry] plug-released 失敗:', error);
        return registryJsonResponse(
            request,
            {
                success: false,
                error: 'DATABASE_ERROR',
                details: error.message,
            },
            500
        );
    }
}

export async function OPTIONS(request: NextRequest) {
    return registryOptionsResponse(request);
}

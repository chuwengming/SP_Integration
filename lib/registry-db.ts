import pool from '@/lib/db';
import { DEFAULT_DEVICE_LOGIN_PASSWORD } from '@/lib/mqtt-defaults';
import { normalizeUiType, type UiType } from '@/lib/ui-type';

export type RegistryRow = {
    factory_serial: string;
    plug_id: string;
    login_password: string;
    registered: 'Yes' | 'No';
};

const DEFAULT_LOGIN_PASSWORD = '123456';

export async function getRegistryByFactorySerial(
    factorySerial: string
): Promise<RegistryRow | null> {
    if (!pool) return null;

    const [rows]: any = await pool.execute(
        'SELECT factory_serial, plug_id, login_password, registered FROM plug_registry WHERE factory_serial = ?',
        [factorySerial]
    );

    if (!rows.length) return null;

    const registered = rows[0].registered === 'Yes' ? 'Yes' : 'No';

    return {
        factory_serial: rows[0].factory_serial,
        plug_id: rows[0].plug_id,
        login_password: rows[0].login_password || DEFAULT_LOGIN_PASSWORD,
        registered,
    };
}

export async function getLoginPasswordByPlugId(plugId: string): Promise<string | null> {
    if (!pool) return null;

    const [rows]: any = await pool.execute(
        'SELECT login_password FROM plug_registry WHERE LOWER(plug_id) = LOWER(?)',
        [plugId.trim()]
    );

    if (!rows.length) return null;
    return rows[0].login_password || DEFAULT_LOGIN_PASSWORD;
}

/** 登入專用：必須在 plug_registry 找到該 PlugID，不得以「查無列 → 預設密碼」放行 */
export type PlugLoginLookup =
    | { status: 'no_database' }
    | { status: 'not_registered' }
    | { status: 'ok'; loginPassword: string; uiType: UiType };

export async function lookupPlugForLogin(plugId: string): Promise<PlugLoginLookup> {
    if (!pool) return { status: 'no_database' };

    const [rows]: any = await pool.execute(
        'SELECT login_password, ui_type FROM plug_registry WHERE LOWER(plug_id) = LOWER(?)',
        [plugId.trim()]
    );

    if (!rows.length) return { status: 'not_registered' };

    return {
        status: 'ok',
        loginPassword: rows[0].login_password || DEFAULT_LOGIN_PASSWORD,
        uiType: normalizeUiType(rows[0].ui_type),
    };
}

/**
 * 依 plugId 查詢 UI 類型（A＝含點動，B＝無點動，C＝定時）。
 * 查無資料或無 DB 連線時預設 A，維持舊設備相容。
 */
export async function getUiTypeByPlugId(plugId: string): Promise<UiType> {
    if (!pool) return 'A';

    const [rows]: any = await pool.execute(
        'SELECT ui_type FROM plug_registry WHERE LOWER(plug_id) = LOWER(?)',
        [plugId.trim()]
    );

    if (!rows.length) return 'A';
    return normalizeUiType(rows[0].ui_type);
}

export async function updateLoginPasswordByFactorySerial(
    factorySerial: string,
    loginPassword: string
): Promise<boolean> {
    if (!pool) return false;

    const [result]: any = await pool.execute(
        'UPDATE plug_registry SET login_password = ?, updated_at = CURRENT_TIMESTAMP WHERE factory_serial = ?',
        [loginPassword, factorySerial]
    );

    return result.affectedRows > 0;
}

/**
 * ESP32 成功寫入 PlugID 至 NVS 後（原子 claim）：
 * - 僅 registered = No 時設為 Yes
 * - created_at 僅在尚未紀錄時寫入（保留首次配號時間）
 */
export async function markPlugIdAssignedByFactorySerial(
    factorySerial: string
): Promise<boolean> {
    if (!pool) return false;

    const [result]: any = await pool.execute(
        `UPDATE plug_registry
         SET registered = 'Yes',
             created_at = COALESCE(created_at, CURRENT_TIMESTAMP)
         WHERE factory_serial = ? AND registered = 'No'`,
        [factorySerial]
    );

    return result.affectedRows > 0;
}

/**
 * ESP32 原廠重置通知中央：
 * - registered = No（可再掃 QR 配號）
 * - login_password 回復預設（與本機出廠密碼一致，否則忘碼後無法登 Next）
 * 優先 factory_serial；若無則用 plug_id。
 */
export async function releasePlugOnFactoryReset(params: {
    factorySerial?: string;
    plugId?: string;
}): Promise<'updated' | 'no_database' | 'not_found'> {
    if (!pool) return 'no_database';

    const factorySerial = params.factorySerial?.trim() || '';
    const plugId = params.plugId?.trim() || '';

    if (factorySerial) {
        const [result]: any = await pool.execute(
            `UPDATE plug_registry
             SET registered = 'No',
                 login_password = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE factory_serial = ?`,
            [DEFAULT_DEVICE_LOGIN_PASSWORD, factorySerial]
        );
        if (result.affectedRows > 0) return 'updated';
    }

    if (plugId) {
        const [result]: any = await pool.execute(
            `UPDATE plug_registry
             SET registered = 'No',
                 login_password = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE LOWER(plug_id) = LOWER(?)`,
            [DEFAULT_DEVICE_LOGIN_PASSWORD, plugId]
        );
        if (result.affectedRows > 0) return 'updated';
    }

    return 'not_found';
}

/** @deprecated 請用 releasePlugOnFactoryReset（會一併重設登入密碼） */
export async function releasePlugByFactorySerial(
    factorySerial: string
): Promise<boolean> {
    const result = await releasePlugOnFactoryReset({ factorySerial });
    return result === 'updated';
}

export async function updateLoginPasswordByPlugId(
    plugId: string,
    loginPassword: string
): Promise<'updated' | 'no_database' | 'not_found'> {
    if (!pool) return 'no_database';

    const normalizedPlugId = plugId.trim();

    const [result]: any = await pool.execute(
        'UPDATE plug_registry SET login_password = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(plug_id) = LOWER(?)',
        [loginPassword, normalizedPlugId]
    );

    if (result.affectedRows > 0) {
        return 'updated';
    }

    return 'not_found';
}

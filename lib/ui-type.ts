export type UiType = 'A' | 'B' | 'C';

/** 正規化 DB / API 回傳的 ui_type（未知值預設 A＝完整操作頁） */
export function normalizeUiType(value: unknown): UiType {
    const raw = String(value ?? 'A').trim().toUpperCase();
    if (raw === 'B') return 'B';
    if (raw === 'C') return 'C';
    return 'A';
}

export type OperationRoute = '/operation' | '/operation-basic' | '/operation-timer';

export function getOperationRoute(uiType: UiType): OperationRoute {
    if (uiType === 'B') return '/operation-basic';
    if (uiType === 'C') return '/operation-timer';
    return '/operation';
}

export function uiTypeFromPath(pathname: string): UiType | null {
    if (pathname === '/operation') return 'A';
    if (pathname === '/operation-basic') return 'B';
    if (pathname === '/operation-timer') return 'C';
    return null;
}

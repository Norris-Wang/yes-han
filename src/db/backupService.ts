
import type { AnswerLog, ReviewDB } from "./db";
import type { ReviewUnit } from "../review/units";

export const BACKUP_FORMAT = "yeshan-learning-backup";
export const BACKUP_FORMAT_VERSION = 1;

export interface LearningBackup {
    format: typeof BACKUP_FORMAT;
    formatVersion: typeof BACKUP_FORMAT_VERSION;
    exportedAt: string;
    source: {
        appVersion: string;
        databaseName: string;
        dexieVersion: number;
        indexedDbVersion: number;
    };
    data: {
        units: ReviewUnit[];
        logs: AnswerLog[];
        localStorage: Record<string, string>;
    };
    summary: {
        unitCount: number;
        logCount: number;
        localStorageKeyCount: number;
    };
}

type ReadableStorage = Pick<
    Storage,
    "length" | "key" | "getItem"
>;

/**
 * 仅备份每日学习记录，不导出其他网站存储内容。
 */
export function isLearningStorageKey(
    key: string
): boolean {
    return /^kr_learned_items_\d{4}-\d{2}-\d{2}$/.test(key);
}

/**
 * 从 localStorage 中提取学习记录。
 * 不执行 setItem、removeItem 或 clear。
 */
export function readLearningStorage(
    storage: ReadableStorage
): Record<string, string> {
    const result: Record<string, string> = {};

    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);

        if (!key || !isLearningStorageKey(key)) {
            continue;
        }

        const value = storage.getItem(key);

        if (value !== null) {
            result[key] = value;
        }
    }

    return result;
}

/**
 * 导出完整学习数据快照。
 *
 * 注意：
 * - IndexedDB 使用只读事务；
 * - 不写入任何记录；
 * - 允许注入独立 ReviewDB 进行测试；
 * - localStorage 原始字符串保持不变。
 */
export async function exportLearningBackup(
    database: ReviewDB,
    storage: ReadableStorage = localStorage,
    appVersion = "0.11.0"
): Promise<LearningBackup> {
    // 先读取 localStorage。
    // 它与 IndexedDB 没有跨存储事务保证。
    const learningStorage = readLearningStorage(storage);

    // units 与 logs 在同一个只读事务中读取。
    const { units, logs } = await database.transaction(
        "r",
        database.units,
        database.logs,
        async () => {
            const [units, logs] = await Promise.all([
                database.units.toArray(),
                database.logs.toArray()
            ]);

            return { units, logs };
        }
    );

    return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        source: {
            appVersion,
            databaseName: database.name,
            dexieVersion: database.verno,
            indexedDbVersion: Math.round(
                database.verno * 10
            )
        },
        data: {
            units,
            logs,
            localStorage: learningStorage
        },
        summary: {
            unitCount: units.length,
            logCount: logs.length,
            localStorageKeyCount:
                Object.keys(learningStorage).length
        }
    };
}

/**
 * 序列化为 JSON。
 * 不修改传入对象。
 */
export function serializeLearningBackup(
    backup: LearningBackup
): string {
    return JSON.stringify(backup, null, 2);
}

/**
 * 浏览器下载帮助函数。
 * 必须在用户主动点击“导出备份”时调用。
 */
export function downloadLearningBackup(
    backup: LearningBackup
): void {
    const json = serializeLearningBackup(backup);

    const blob = new Blob([json], {
        type: "application/json;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;

    const stamp = backup.exportedAt
        .replace(/[:.]/g, "-");

    link.download = `yeshan-backup-${stamp}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    // 延迟释放，避免影响浏览器下载。
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}
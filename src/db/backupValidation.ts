
import {
    BACKUP_FORMAT,
    BACKUP_FORMAT_VERSION,
    type LearningBackup,
    isLearningStorageKey
} from "./backupService";

export interface BackupIssue {
    severity: "error" | "warning";
    path: string;
    message: string;
}

export interface BackupValidationResult {
    valid: boolean;
    backup: LearningBackup | null;
    issues: BackupIssue[];
    stats: {
        units: number;
        logs: number;
        fixed: number;
        fsrs: number;
        learningKeys: number;
        orphanLogs: number;
    };
}

const MAX_ISSUES = 100;

function isObject(
    value: unknown
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isFiniteNumber(
    value: unknown
): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value)
    );
}

function isNonnegativeInteger(value: unknown): boolean {
    return (
        isFiniteNumber(value) &&
        Number.isSafeInteger(value) &&
        value >= 0
    );
}

export function validateLearningBackup(
    input: unknown
): BackupValidationResult {
    const issues: BackupIssue[] = [];

    let hasErrors = false;

    const stats = {
        units: 0,
        logs: 0,
        fixed: 0,
        fsrs: 0,
        learningKeys: 0,
        orphanLogs: 0
    };

    const issue = (
        severity: BackupIssue["severity"],
        path: string,
        message: string
    ) => {
        if (severity === "error") {
            hasErrors = true;
        }

        if (issues.length < MAX_ISSUES) {
            issues.push({ severity, path, message });
        }
    };

    if (!isObject(input)) {
        issue("error", "$", "备份必须是 JSON 对象");
        return {
            valid: false,
            backup: null,
            issues,
            stats
        };
    }

    if (input.format !== BACKUP_FORMAT) {
        issue("error", "format", "备份格式标识不匹配");
    }

    if (input.formatVersion !== BACKUP_FORMAT_VERSION) {
        issue(
            "error",
            "formatVersion",
            "不支持的备份格式版本"
        );
    }

    if (
        !isString(input.exportedAt) ||
        !Number.isFinite(Date.parse(input.exportedAt))
    ) {
        issue("error", "exportedAt", "导出时间无效");
    }

    const source = input.source;

    if (!isObject(source)) {
        issue("error", "source", "缺少来源信息");
    } else {
        if (!isString(source.appVersion)) {
            issue("error", "source.appVersion", "应用版本无效");
        }
        if (!isString(source.databaseName)) {
            issue("error", "source.databaseName", "数据库名称无效");
        }
        if (!isFiniteNumber(source.dexieVersion)) {
            issue("error", "source.dexieVersion", "Dexie 版本无效");
        }
        if (!isFiniteNumber(source.indexedDbVersion)) {
            issue(
                "error",
                "source.indexedDbVersion",
                "IndexedDB 版本无效"
            );
        }
    }

    const data = input.data;

    if (!isObject(data)) {
        issue("error", "data", "缺少备份数据");
        return {
            valid: false,
            backup: null,
            issues,
            stats
        };
    }

    const units = data.units;
    const logs = data.logs;
    const local = data.localStorage;

    if (!Array.isArray(units)) {
        issue("error", "data.units", "units 必须是数组");
    }

    if (!Array.isArray(logs)) {
        issue("error", "data.logs", "logs 必须是数组");
    }

    if (!isObject(local)) {
        issue(
            "error",
            "data.localStorage",
            "localStorage 必须是对象"
        );
    }

    const unitKeys = new Set<string>();

    if (Array.isArray(units)) {
        stats.units = units.length;

        units.forEach((unit: unknown, i: number) => {
            const path = `data.units[${i}]`;

            if (!isObject(unit)) {
                issue("error", path, "单元必须是对象");
                return;
            }

            if (!isString(unit.key) || !unit.key) {
                issue("error", `${path}.key`, "无效主键");
            } else if (unitKeys.has(unit.key)) {
                issue("error", `${path}.key`, "重复的单元主键");
            } else {
                unitKeys.add(unit.key);
            }

            if (
                !isString(unit.lessonId) ||
                !isString(unit.itemId) ||
                !isString(unit.direction)
            ) {
                issue(
                    "error",
                    path,
                    "课程、知识点或练习方向字段无效"
                );
            }

            if (
                unit.itemType !== "vocab" &&
                unit.itemType !== "grammar" &&
                unit.itemType !== "topic"
            ) {
                issue("error", `${path}.itemType`, "知识类型无效");
            }

            for (const field of [
                "stage",
                "streak",
                "lapses",
                "seen"
            ]) {
                if (!isNonnegativeInteger(unit[field])) {
                    issue(
                        "error",
                        `${path}.${field}`,
                        "必须是非负安全整数"
                    );
                }
            }

            if (!isFiniteNumber(unit.dueAt)) {
                issue(
                    "error",
                    `${path}.dueAt`,
                    "下次复习时间无效"
                );
            }

            const algorithm =
                unit.schedulingAlgorithm ?? "fixed";

            if (algorithm === "fsrs") {
                stats.fsrs++;

                if (unit.fsrsCard !== undefined) {
                    if (
                        !isObject(unit.fsrsCard) ||
                        !isFiniteNumber(unit.fsrsCard.due)
                    ) {
                        issue(
                            "error",
                            `${path}.fsrsCard`,
                            "FSRS 卡片或 due 无效"
                        );
                    } else {
                        const card = unit.fsrsCard;

                        for (const field of [
                            "stability",
                            "difficulty",
                            "state",
                            "reps",
                            "lapses",
                            "elapsed_days",
                            "scheduled_days"
                        ]) {
                            if (!isFiniteNumber(card[field])) {
                                issue(
                                    "error",
                                    `${path}.fsrsCard.${field}`,
                                    "FSRS 数值字段无效"
                                );
                            }
                        }

                        if (
                            card.last_review !== undefined &&
                            !isFiniteNumber(card.last_review)
                        ) {
                            issue(
                                "error",
                                `${path}.fsrsCard.last_review`,
                                "上次复习时间无效"
                            );
                        }
                    }
                } else if (
                    isFiniteNumber(unit.seen) &&
                    unit.seen > 0
                ) {
                    issue(
                        "error",
                        `${path}.fsrsCard`,
                        "已学习的 FSRS 单元缺少卡片"
                    );
                }
            } else if (algorithm === "fixed") {
                stats.fixed++;
            } else {
                issue(
                    "error",
                    `${path}.schedulingAlgorithm`,
                    "未知调度算法"
                );
            }
        });
    }

    const logIds = new Set<number>();

    if (Array.isArray(logs)) {
        stats.logs = logs.length;

        logs.forEach((log: unknown, i: number) => {
            const path = `data.logs[${i}]`;

            if (!isObject(log)) {
                issue("error", path, "日志必须是对象");
                return;
            }

            if (
                !isNonnegativeInteger(log.id) ||
                log.id === 0
            ) {
                issue("error", `${path}.id`, "日志 ID 无效");
            } else if (logIds.has(log.id as number)) {
                issue("error", `${path}.id`, "重复的日志 ID");
            } else {
                logIds.add(log.id as number);
            }

            if (
                !isString(log.unitKey) ||
                !log.unitKey
            ) {
                issue("error", `${path}.unitKey`, "单元引用无效");
            } else if (
                Array.isArray(units) &&
                !unitKeys.has(log.unitKey)
            ) {
                stats.orphanLogs++;
                issue(
                    "warning",
                    `${path}.unitKey`,
                    "日志引用的单元不存在于备份中"
                );
            }

            if (typeof log.correct !== "boolean") {
                issue("error", `${path}.correct`, "正确性无效");
            }

            if (!isFiniteNumber(log.at)) {
                issue("error", `${path}.at`, "答题时间无效");
            }

            if (!isString(log.type)) {
                issue("error", `${path}.type`, "题型无效");
            }

            if (
                log.algorithm !== undefined &&
                log.algorithm !== "fixed" &&
                log.algorithm !== "fsrs"
            ) {
                issue("error", `${path}.algorithm`, "算法无效");
            }

            if (
                log.rating !== undefined &&
                ![1, 2, 3, 4].includes(log.rating as number)
            ) {
                issue("error", `${path}.rating`, "评分无效");
            }

            if (
                log.algorithm === "fsrs" &&
                log.rating === undefined
            ) {
                issue(
                    "warning",
                    `${path}.rating`,
                    "FSRS 日志没有评分"
                );
            }

            if (
                log.rating !== undefined &&
                [1, 2, 3, 4].includes(log.rating as number) &&
                (
                    (log.correct === false && log.rating !== 1) ||
                    (log.correct === true && log.rating === 1)
                )
            ) {
                issue(
                    "error",
                    `${path}.rating`,
                    "评分与正确性不一致"
                );
            }
        });
    }

    if (isObject(local)) {
        for (const [key, value] of Object.entries(local)) {
            if (!isLearningStorageKey(key)) {
                issue(
                    "error",
                    `data.localStorage.${key}`,
                    "不允许的 localStorage 键"
                );
                continue;
            }

            stats.learningKeys++;

            if (!isString(value)) {
                issue(
                    "error",
                    `data.localStorage.${key}`,
                    "学习记录不是字符串"
                );
                continue;
            }

            try {
                const parsed: unknown = JSON.parse(value);

                if (
                    !Array.isArray(parsed) ||
                    !parsed.every(x => typeof x === "string")
                ) {
                    issue(
                        "error",
                        `data.localStorage.${key}`,
                        "每日学习记录必须是字符串数组"
                    );
                }
            } catch {
                issue(
                    "error",
                    `data.localStorage.${key}`,
                    "每日学习记录不是有效 JSON"
                );
            }
        }
    }

    const summary = input.summary;

    if (!isObject(summary)) {
        issue("error", "summary", "缺少统计摘要");
    } else if (
        summary.unitCount !== stats.units ||
        summary.logCount !== stats.logs ||
        summary.localStorageKeyCount !== stats.learningKeys
    ) {
        issue(
            "error",
            "summary",
            "统计摘要与实际数据数量不一致"
        );
    }

    const valid = !hasErrors;

    return {
        valid,
        backup: valid ? input as unknown as LearningBackup : null,
        issues,
        stats
    };
}

export function parseLearningBackupJson(
    json: string
): BackupValidationResult {
    try {
        const input: unknown = JSON.parse(json);
        return validateLearningBackup(input);
    } catch {
        return {
            valid: false,
            backup: null,
            issues: [{
                severity: "error",
                path: "$",
                message: "JSON 解析失败"
            }],
            stats: {
                units: 0,
                logs: 0,
                fixed: 0,
                fsrs: 0,
                learningKeys: 0,
                orphanLogs: 0
            }
        };
    }
}
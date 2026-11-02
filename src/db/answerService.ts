
import type { Grade } from "ts-fsrs";

import { db, type ReviewDB } from "./db";
import type { ReviewUnit } from "../review/units";
import type { GeneratedQuestion } from "../generators/types";

import { calculateNextReview } from "../review/schedulingService";
import { withLearningWriteLock } from "./learningWriteGate";

/**
 * 内部数据库事务。
 *
 * 调用方必须已经持有该数据库的写入锁。
 * 不导出，避免外部绕过统一门禁。
 */
async function persistAnswerInTransaction(
    database: ReviewDB,
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"],
    now: number,
    rating?: Grade
): Promise<ReviewUnit> {
    return database.transaction(
        "rw",
        database.units,
        database.logs,
        async () => {
            const unit = await database.units.get(unitKey);

            if (!unit) {
                throw new Error(
                    `找不到复习单元：${unitKey}`
                );
            }

            const algorithm =
                unit.schedulingAlgorithm ?? "fixed";

            const updated = calculateNextReview(
                unit,
                correct,
                now,
                rating
            );

            // 单元更新与日志写入必须在同一事务中。
            await database.units.put(updated);

            await database.logs.add({
                unitKey,
                correct,
                at: now,
                type: questionType,
                algorithm,
                ...(algorithm === "fsrs"
                    ? { rating }
                    : {})
            });

            return updated;
        }
    );
}

/**
 * 公开保存入口：统一独占锁。
 *
 * 保持参数签名不变，兼容现有错题本和测试。
 * 锁不可用或发生冲突时，不执行数据库事务。
 */
export function saveAnswerToDb(
    database: ReviewDB,
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"],
    now = Date.now(),
    rating?: Grade
): Promise<ReviewUnit> {
    return withLearningWriteLock(
        database.name,
        () => persistAnswerInTransaction(
            database,
            unitKey,
            correct,
            questionType,
            now,
            rating
        )
    );
}



/**
 * 每日学习记录使用的最小存储接口。
 * 测试时注入内存对象，不接触真实 localStorage。
 */
export type DailyLearningStore = Pick<
    Storage,
    "getItem" | "setItem"
>;

export type DailyWriteStatus =
    | "written"
    | "already_present"
    | "not_needed"
    | "failed";

export interface DailyWriteResult {
    status: DailyWriteStatus;
    dayKey: string;
    items: string[] | null;
    error?: string;
}

export interface AnswerWithDailyResult {
    updated: ReviewUnit;
    daily: DailyWriteResult;
}

function dailyKeyAt(now: number): string {
    const d = new Date(now);

    const yyyy = d.getFullYear();
    const mm = String(
        d.getMonth() + 1
    ).padStart(2, "0");

    const dd = String(
        d.getDate()
    ).padStart(2, "0");

    return `kr_learned_items_${yyyy}-${mm}-${dd}`;
}

/**
 * 仅负责每日记录。
 *
 * 写入新的 lessonId|type|itemId 格式，
 * 同时识别旧的 type_itemId 格式，避免重复计入。
 *
 * 注意：这个函数自身不加锁；
 * 只能从已经持锁的函数中调用。
 */
function writeDailyAfterCommit(
    storage: DailyLearningStore,
    unit: ReviewUnit,
    dayKey: string
): DailyWriteResult {
    try {
        const raw = storage.getItem(dayKey);

        const parsed: unknown =
            raw === null ? [] : JSON.parse(raw);

        if (
            !Array.isArray(parsed) ||
            !parsed.every(
                item => typeof item === "string"
            )
        ) {
            throw new Error(
                "已有每日学习记录格式无效，拒绝覆盖"
            );
        }

        const items: string[] = parsed;

        const scopedKey = [
            unit.lessonId,
            unit.itemType,
            unit.itemId
        ].join("|");

        const legacyKey =
            `${unit.itemType}_${unit.itemId}`;

        if (
            items.includes(scopedKey) ||
            items.includes(legacyKey)
        ) {
            return {
                status: "already_present",
                dayKey,
                items
            };
        }

        const next = [...items, scopedKey];

        // 仅更新一个指定日期键，不调用 clear。
        storage.setItem(
            dayKey,
            JSON.stringify(next)
        );

        return {
            status: "written",
            dayKey,
            items: next
        };

    } catch (error) {
        return {
            status: "failed",
            dayKey,
            items: null,
            error: error instanceof Error
                ? error.message
                : String(error)
        };
    }
}

/**
 * 完整保存一次每日复习答案。
 *
 * 一把锁覆盖：
 * 1. IndexedDB 答题事务
 * 2. 首次学习的每日记录更新
 *
 * 如果 IndexedDB 已经提交，
 * 后续的 localStorage 异常只会反映在 daily.status，
 * 不会被伪装成整次答题失败。
 */
export function saveAnswerWithDailyToDb(
    database: ReviewDB,
    storage: DailyLearningStore,
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"],
    now = Date.now(),
    rating?: Grade
): Promise<AnswerWithDailyResult> {
    const dayKey = dailyKeyAt(now);

    return withLearningWriteLock(
        database.name,
        async () => {
            // 注意：调用未加锁的内部事务函数，
            // 不能调用已经自带锁的 saveAnswerToDb。
            const updated =
                await persistAnswerInTransaction(
                    database,
                    unitKey,
                    correct,
                    questionType,
                    now,
                    rating
                );

            const daily: DailyWriteResult =
                updated.seen === 1
                    ? writeDailyAfterCommit(
                        storage,
                        updated,
                        dayKey
                    )
                    : {
                        status: "not_needed",
                        dayKey,
                        items: null
                    };

            return { updated, daily };
        }
    );
}

/**
 * 仅修复每日记录，不再次保存答案。
 *
 * 在数据库已经提交而每日记录失败时使用。
 * 该函数不会向 logs 添加任何记录。
 */
export function repairDailyRecordToDb(
    database: ReviewDB,
    storage: DailyLearningStore,
    unitKey: string,
    dayKey: string
): Promise<DailyWriteResult> {
    if (
        !/^kr_learned_items_\d{4}-\d{2}-\d{2}$/.test(
            dayKey
        )
    ) {
        throw new Error(
            "每日记录日期键无效"
        );
    }

    return withLearningWriteLock(
        database.name,
        async () => {
            const unit =
                await database.units.get(unitKey);

            if (!unit || unit.seen < 1) {
                throw new Error(
                    "不能修复尚未保存的学习单元"
                );
            }

            return writeDailyAfterCommit(
                storage,
                unit,
                dayKey
            );
        }
    );
}

/**
 * 正式应用原有入口。
 *
 * 不在这里再次加锁，
 * 因为 saveAnswerToDb 已经统一负责加锁。
 */
export function saveAnswer(
    unitKey: string,
    correct: boolean,
    questionType: GeneratedQuestion["type"],
    rating?: Grade
): Promise<ReviewUnit> {
    return saveAnswerToDb(
        db,
        unitKey,
        correct,
        questionType,
        Date.now(),
        rating
    );
}
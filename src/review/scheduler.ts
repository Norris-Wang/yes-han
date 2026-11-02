
import type { ReviewUnit } from "./units";

// 仍使用原有复习阶段，不改数据库结构
const INTERVALS = [
    1,   // 第一次答对：1天后
    3,   // 第二阶段：3天后
    7,   // 第三阶段：7天后
    14,  // 第四阶段：14天后
    30,  // 第五阶段：30天后
    60   // 第六阶段及以后：60天后
];

const DAY_MS = 24 * 60 * 60 * 1000;

// 答错后较快安排再次复习
const RETRY_MS = 10 * 60 * 1000;

export function schedule(
    unit: ReviewUnit,
    correct: boolean,
    now = Date.now()
): void {
    const firstAttempt = unit.seen === 0;

    if (correct) {
        unit.stage = Math.min(
            unit.stage + 1,
            INTERVALS.length
        );

        unit.streak += 1;

        // stage 从 1 开始表示首次答对
        // 所以取 stage - 1 对应的间隔
        const intervalIndex = Math.min(
            INTERVALS.length - 1,
            Math.max(0, unit.stage - 1)
        );

        unit.dueAt =
            now + INTERVALS[intervalIndex] * DAY_MS;

    } else {
        unit.stage = Math.max(
            unit.stage - 1,
            0
        );

        unit.streak = 0;
        unit.lapses += 1;

        // 首次学习或复习答错，
        // 均安排短时间后的强化复习
        unit.dueAt = now + RETRY_MS;
    }

    unit.seen += 1;

    // 保留变量以便以后区分首次学习策略
    void firstAttempt;
}

import type { ReviewUnit } from "./units";

type ItemType = ReviewUnit["itemType"];

/**
 * 统计指定类型的每日已学习知识点。
 *
 * 兼容：
 * 旧格式：vocab_123
 * 新格式：L01|vocab|123
 *
 * 同一个旧知识点如果已有新格式记录，
 * 不重复计算。
 */
export function countDailyLearnedByType(
    items: readonly string[],
    type: ItemType
): number {
    const scoped = new Set<string>();
    const scopedItemIds = new Set<string>();
    const legacyItemIds = new Set<string>();

    for (const item of items) {
        const parts = item.split("|");

        if (
            parts.length === 3 &&
            parts[0] !== "" &&
            parts[1] === type &&
            parts[2] !== ""
        ) {
            scoped.add(`${parts[0]}|${parts[2]}`);
            scopedItemIds.add(parts[2]);
            continue;
        }

        const prefix = `${type}_`;

        if (item.startsWith(prefix)) {
            legacyItemIds.add(
                item.slice(prefix.length)
            );
        }
    }

    let count = scoped.size;

    for (const id of legacyItemIds) {
        if (!scopedItemIds.has(id)) {
            count++;
        }
    }

    return count;
}
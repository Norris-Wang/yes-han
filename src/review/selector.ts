
import type { ReviewUnit } from "./units";


type ItemType = ReviewUnit["itemType"];

const TYPES: ItemType[] = [
    "vocab",
    "grammar",
    "topic"
];

// 题型的软目标数量
const TARGETS: Record<ItemType, number> = {
    vocab: 10,
    grammar: 6,
    topic: 4
};

/**
 * 唯一知识点标识。
 * 包含课程 ID，避免不同课程的 itemId 碰撞。
 */
export function getItemKey(
    unit: ReviewUnit
): string {
    return [
        unit.lessonId,
        unit.itemType,
        unit.itemId
    ].join("|");
}

/**
 * 比较知识点复习优先级。
 *
 * 1. 更早到期
 * 2. 错误次数更多
 * 3. 复习阶段更低
 */
function comparePriority(
    a: ReviewUnit,
    b: ReviewUnit
): number {
    if (a.dueAt !== b.dueAt) {
        return a.dueAt - b.dueAt;
    }

    if (a.lapses !== b.lapses) {
        return b.lapses - a.lapses;
    }

    return a.stage - b.stage;
}

/**
 * 同一个知识点可能有多个复习方向。
 * 优先保留到期更早的方向。
 */
function deduplicateItems(
    units: ReviewUnit[]
): ReviewUnit[] {
    const sorted = [...units].sort((a, b) => {
        // 已经练习过的方向优先于全新方向
        if ((a.seen > 0) !== (b.seen > 0)) {
            return a.seen > 0 ? -1 : 1;
        }

        // 同为新练习时，优先代表性的主动输出
        if (a.seen === 0 && b.seen === 0) {
            const preferred = (
                unit: ReviewUnit
            ) => {
                if (unit.itemType === "topic") {
                    return unit.direction === "order" ? 0 : 1;
                }

                return unit.direction === "fill" ? 0 : 1;
            };

            const difference = preferred(a) - preferred(b);

            if (difference !== 0) {
                return difference;
            }
        }

        return comparePriority(a, b);
    });

    const seen = new Set<string>();
    const result: ReviewUnit[] = [];

    for (const unit of sorted) {
        const itemKey = getItemKey(unit);

        if (seen.has(itemKey)) {
            continue;
        }

        seen.add(itemKey);
        result.push(unit);
    }

    return result;
}

/**
 * 从某个优先级层中选择题目。
 *
 * 尽量靠近词汇10、语法6、对话4的比例。
 * 如果某种题目不足，把名额交给其他类型。
 */
function selectBalanced(
    pool: ReviewUnit[],
    maxCount: number
): ReviewUnit[] {
    const unique = deduplicateItems(pool);

    const groups: Record<ItemType, ReviewUnit[]> = {
        vocab: [],
        grammar: [],
        topic: []
    };

    for (const unit of unique) {
        groups[unit.itemType].push(unit);
    }

    const selected: ReviewUnit[] = [];

    while (selected.length < maxCount) {
        const available = TYPES.filter(
            type => groups[type].length > 0
        );

        if (available.length === 0) {
            break;
        }

        // 优先选择当前目标完成比例最低的类型
        available.sort((a, b) => {
            const countA = selected.filter(
                u => u.itemType === a
            ).length;

            const countB = selected.filter(
                u => u.itemType === b
            ).length;

            const ratioA = countA / TARGETS[a];
            const ratioB = countB / TARGETS[b];

            if (ratioA !== ratioB) {
                return ratioA - ratioB;
            }

            return TYPES.indexOf(a) - TYPES.indexOf(b);
        });

        const type = available[0];
        const next = groups[type].shift();

        if (next) {
            selected.push(next);
        }
    }

    return selected;
}

/**
 * 为一轮复习选择题目。
 *
 * due 模式：
 * 先选择已学且到期的内容，
 * 有剩余名额时补充新知识。
 *
 * 其他模式：
 * 从指定题池中平衡选择。
 */
export function selectSessionUnits(
    pool: ReviewUnit[],
    mode: string,
    now = Date.now(),
    maxCount = pool.length
): ReviewUnit[] {
    if (maxCount <= 0) {
        return [];
    }

    if (mode !== "due") {
        return selectBalanced(pool, maxCount);
    }

    const due = pool.filter(
        u => u.seen > 0 && u.dueAt <= now
    );

    const fresh = pool.filter(
        u => u.seen === 0
    );

    // 第一步：优先安排到期知识
    const selected = selectBalanced(due, maxCount);

    const selectedKeys = new Set(
        selected.map(getItemKey)
    );

    // 第二步：利用剩余名额学习新知识
    const remaining = maxCount - selected.length;

    if (remaining > 0) {
        const candidates = fresh.filter(
            u => !selectedKeys.has(getItemKey(u))
        );

        const newSelected = selectBalanced(
            candidates,
            remaining
        );

        selected.push(...newSelected);
    }

    return selected;
}


export interface DailyCandidatePools {
    due: ReviewUnit[];
    progression: ReviewUnit[];
    fresh: ReviewUnit[];
}

/**
 * 每日复习选题：
 * 1. 到期旧知识
 * 2. 已学知识的新练习方向
 * 3. 从未接触的新知识
 *
 * 每个优先级内部尽量平衡词汇、语法和话题。
 * 不同优先级之间按照知识点去重。
 */
export function selectDailyUnits(
    pools: DailyCandidatePools,
    maxCount =
        pools.due.length +
        pools.progression.length +
        pools.fresh.length
): ReviewUnit[] {
    if (maxCount <= 0) {
        return [];
    }

    const selected: ReviewUnit[] = [];
    const usedItems = new Set<string>();

    const layers = [
        pools.due,
        pools.progression,
        pools.fresh
    ];

    for (const layer of layers) {
        const remaining = maxCount - selected.length;

        if (remaining <= 0) {
            break;
        }

        // 去掉前面优先级已经选中的知识点
        const candidates = layer.filter(unit =>
            !usedItems.has(getItemKey(unit))
        );

        const picked = selectBalanced(
            candidates,
            remaining
        );

        for (const unit of picked) {
            const itemKey = getItemKey(unit);

            if (usedItems.has(itemKey)) {
                continue;
            }

            usedItems.add(itemKey);
            selected.push(unit);
        }
    }

    return selected;
}

import type { ReviewUnit } from "./units";
import { getEligibleUnits, getKnowledgeKey } from "./progression";
import type { DailyCandidatePools } from "./selector";
import { countDailyLearnedByType } from "./dailyLearnedCount";

type ItemType = ReviewUnit["itemType"];

export type DailyLimits = Record<ItemType, number>;

export function countLearnedByType(
    learnedItems: string[],
    type: ItemType
): number {
    return countDailyLearnedByType(learnedItems, type);
}

export function buildDailyCandidatePools(
    allUnits: ReviewUnit[],
    learnedItems: string[],
    isAnswerable: (unit: ReviewUnit) => boolean,
    limits: DailyLimits | null,
    now = Date.now()
): DailyCandidatePools {
    const eligible = getEligibleUnits(
        allUnits.filter(isAnswerable)
    );

    const knownKeys = new Set(
        allUnits
            .filter(unit => unit.seen > 0)
            .map(getKnowledgeKey)
    );

    const due = eligible.filter(unit =>
        unit.seen > 0 && unit.dueAt <= now
    );

    const unstarted = eligible.filter(
        unit => unit.seen === 0
    );

    const progression = unstarted.filter(
        unit => knownKeys.has(getKnowledgeKey(unit))
    );

    const freshCandidates = unstarted.filter(
        unit => !knownKeys.has(getKnowledgeKey(unit))
    );

    if (limits === null) {
        return {
            due,
            progression,
            fresh: freshCandidates
        };
    }

    const remaining: DailyLimits = {
        vocab: Math.max(
            0,
            limits.vocab -
            countLearnedByType(learnedItems, "vocab")
        ),
        grammar: Math.max(
            0,
            limits.grammar -
            countLearnedByType(learnedItems, "grammar")
        ),
        topic: Math.max(
            0,
            limits.topic -
            countLearnedByType(learnedItems, "topic")
        )
    };

    const allowedKeys = new Set<string>();

    for (const unit of freshCandidates) {
        const key = getKnowledgeKey(unit);

        if (allowedKeys.has(key)) continue;
        if (remaining[unit.itemType] <= 0) continue;

        allowedKeys.add(key);
        remaining[unit.itemType]--;
    }

    const fresh = freshCandidates.filter(unit =>
        allowedKeys.has(getKnowledgeKey(unit))
    );

    return { due, progression, fresh };
}
import type { KnowledgeBase, Vocab } from "../data/schema";

export function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function normalize(s: string): string {
    return String(s).trim().replace(/\s+/g, " ").replace(/[.?!。？！]+$/g, "").toLowerCase();
}

// 构建词汇索引，用于找干扰项
export function buildVocabIndex(kb: KnowledgeBase) {
    const groupOf = new Map<string, string>();
    const contextOf = new Map<string, string>();
    const allVocab: Vocab[] = [];

    for (const lesson of kb.lessons) {
        for (const group of lesson.vocabGroups) {
            for (const vocab of group.items) {
                groupOf.set(vocab.id, group.id);

                const context =
                    vocab.context?.trim() ||
                    group.context?.trim();

                if (context) {
                    contextOf.set(vocab.id, context);
                }

                allVocab.push(vocab);
            }
        }
    }

    return { groupOf, contextOf, allVocab };
}

// 抽取干扰项
export function pickDistractors(
    target: Vocab,
    allVocab: Vocab[],
    groupOf: Map<string, string>,
    n: number,
    useMeaning: boolean
): string[] {
    const field = useMeaning ? "meaning" : "word";
    const targetVal = target[field];
    const targetGroup = groupOf.get(target.id);
    const sameGroup = allVocab.filter(v => v.id !== target.id && groupOf.get(v.id) === targetGroup);
    const others = allVocab.filter(v => v.id !== target.id && groupOf.get(v.id) !== targetGroup);
    const pool = [...shuffle(sameGroup), ...shuffle(others)];
    const out: string[] = [];
    const used = new Set([targetVal]);
    for (const v of pool) {
        const val = v[field];
        if (used.has(val)) continue;
        used.add(val);
        out.push(val);
        if (out.length === n) break;
    }
    return out;
}


const VOCAB_TAG_LABELS: Record<string, string> = {
    "동사": "动词",
    "형용사": "形容词",
    "존대어": "敬语",
    "수": "数词",
    "단위": "单位词"
};

// 只显示真正有助于答题的标签。
// 家庭、食物、交通等主题标签暂不显示。
export function getVocabTagHint(
    tags: readonly string[]
): string {
    const labels = tags
        .map(tag => VOCAB_TAG_LABELS[tag])
        .filter(
            (label): label is string =>
                typeof label === "string"
        );

    return [...new Set(labels)].join(" · ");
}

// 生成用于消除歧义的完整说明。
// 优先利用 tags，必要时补充 context。
export function getVocabDescriptor(
    vocab: Pick<Vocab, "tags" | "context">,
    groupContext?: string
): string {
    const tagHint = getVocabTagHint(vocab.tags);

    const rawContext =
        vocab.context?.trim() ||
        groupContext?.trim() ||
        "";

    // 避免出现“动词原形 · 动词”这种重复说明。
    const context =
        rawContext && !tagHint.includes(rawContext)
            ? rawContext
            : "";

    return [tagHint, context]
        .filter(Boolean)
        .join(" · ");
}


export function getVocabPrompt(
    v: Vocab,
    kb: KnowledgeBase,
    direction: "kr2zh" | "zh2kr"
): string {
    const { allVocab, contextOf } =
        buildVocabIndex(kb);

    const ambiguous = allVocab.some(other => {
        if (direction === "kr2zh") {
            return (
                other.word === v.word &&
                other.meaning !== v.meaning
            );
        }

        return (
            other.meaning === v.meaning &&
            other.word !== v.word
        );
    });

    const raw =
        direction === "kr2zh"
            ? v.word
            : v.meaning;

    let descriptor = "";

    if (ambiguous) {
        // 有歧义时，标签和 context 一起参与区分。
        descriptor = getVocabDescriptor(
            v,
            contextOf.get(v.id)
        );
    } else if (direction === "zh2kr") {
        // 中→韩：即使没有歧义，也提示词性。
        descriptor = getVocabTagHint(v.tags);
    }

    if (ambiguous && !descriptor) {
        throw new Error(
            `词汇 ${v.id}（${v.word}）存在歧义，` +
            "需要补充可区分答案的 context"
        );
    }

    return descriptor
        ? `${raw}（${descriptor}）`
        : raw;
}
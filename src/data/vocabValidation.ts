
import type { KnowledgeBase } from "./schema";
import { getVocabDescriptor } from "../generators/utils";

/**
 * 检查不同词汇答案是否能通过标签或语境区分。
 * tags 优先，context 作为补充。
 */
export function assertVocabularyDisambiguation(
    kb: KnowledgeBase
): void {
    const entries = kb.lessons.flatMap(lesson =>
        lesson.vocabGroups.flatMap(group =>
            group.items.map(vocab => ({
                id: `${lesson.id}/${vocab.id}`,
                word: vocab.word,
                meaning: vocab.meaning,
                tags: vocab.tags,
                context:
                    vocab.context?.trim() ||
                    group.context?.trim() ||
                    ""
            }))
        )
    );

    for (const target of entries) {
        const conflicts = entries.filter(other =>
            (
                other.word === target.word &&
                other.meaning !== target.meaning
            ) ||
            (
                other.meaning === target.meaning &&
                other.word !== target.word
            )
        );

        if (conflicts.length === 0) {
            continue;
        }

        const targetLabel =
            getVocabDescriptor(target);

        if (!targetLabel) {
            throw new Error(
                `词汇 ${target.id}（${target.word}）` +
                "存在歧义，tags 无法提供有效提示，" +
                "请添加 context"
            );
        }

        for (const other of conflicts) {
            const otherLabel =
                getVocabDescriptor(other);

            if (
                !otherLabel ||
                targetLabel === otherLabel
            ) {
                throw new Error(
                    `词汇 ${target.id} 与 ${other.id} ` +
                    "答案存在歧义，当前标签和语境" +
                    "不足以区分，请补充不同的 context"
                );
            }
        }
    }
}
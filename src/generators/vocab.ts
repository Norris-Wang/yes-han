import type { KnowledgeBase, Vocab } from "../data/schema";
import type { GeneratedQuestion } from "./types";
import { shuffle, buildVocabIndex, pickDistractors, getVocabPrompt } from "./utils";

export function genVocabKr2Zh(v: Vocab, kb: KnowledgeBase): GeneratedQuestion {
    const { groupOf, allVocab } = buildVocabIndex(kb);
    return {
        type: "vocab_mc_kr2zh",
        prompt: getVocabPrompt(v, kb, "kr2zh"),
        choices: shuffle([v.meaning, ...pickDistractors(v, allVocab, groupOf, 3, true)]),
        answer: v.meaning,
        explanation: `${v.word} = ${v.meaning}`,
    };
}

export function genVocabZh2Kr(v: Vocab, kb: KnowledgeBase): GeneratedQuestion {
    const { groupOf, allVocab } = buildVocabIndex(kb);
    return {
        type: "vocab_mc_zh2kr",
        prompt: getVocabPrompt(v, kb, "zh2kr"),
        choices: shuffle([v.word, ...pickDistractors(v, allVocab, groupOf, 3, false)]),
        answer: v.word,
        explanation: `${v.meaning} = ${v.word}`,
    };
}

export function genVocabFill(v: Vocab, kb: KnowledgeBase): GeneratedQuestion {
    const acceptList = new Set<string>([v.word]);

    if (v.accept) {
        v.accept.forEach(a => acceptList.add(a));
    }

    return {
        type: "vocab_fill",
        prompt: [
            getVocabPrompt(v, kb, "zh2kr"),
            v.hint ? `（${v.hint}）` : ""
        ].filter(Boolean).join("\n"),
        answer: v.word,
        accept: Array.from(acceptList),
        explanation: `${v.meaning} = ${v.word}`,
        isFill: true,
    };
}
import type { Grammar, GrammarExample } from "../data/schema";
import type { GeneratedQuestion } from "./types";
import { shuffle } from "./utils";

export function genGrammar(
    g: Grammar,
    direction: string,
    exampleIndex?: number
): GeneratedQuestion | null {
    const ex: GrammarExample | undefined =
        exampleIndex === undefined
            ? g.examples[Math.floor(Math.random() * g.examples.length)]
            : g.examples[exampleIndex];
    if (!ex) return null;

    const hintPrefix = ex.hint ? `【${ex.hint}】\n` : "";
    const dictHint =
        ex.dictionaryForm &&
            ex.dictionaryForm.trim() !== ex.answer.trim()
            ? `（${ex.dictionaryForm}）`
            : "";
    const blank = `＿＿＿${dictHint}`;

    let sentenceWithBlank: string;

    if (ex.cloze !== undefined) {
        const marker = `{${ex.focus}}`;

        if (
            ex.cloze.split(marker).length !== 2 ||
            ex.cloze.replace(marker, ex.focus) !== ex.sentence
        ) {
            throw new Error(
                `Invalid grammar cloze: ${ex.sentence}`
            );
        }

        sentenceWithBlank = ex.cloze.replace(
            marker,
            blank
        );
    } else {
        if (
            !ex.focus ||
            ex.sentence.split(ex.focus).length !== 2
        ) {
            throw new Error(
                `Ambiguous grammar focus: ${ex.sentence}`
            );
        }

        sentenceWithBlank = ex.sentence.replace(
            ex.focus,
            blank
        );
    }

    const promptText = hintPrefix + sentenceWithBlank;
    const explanation = `${g.name}：${g.function}\n例句：${ex.sentence}${ex.translation ? " — " + ex.translation : ""}`;

    if (direction === "mc" && ex.choices && ex.choices.length > 0) {
        return {
            type: "grammar_mc",
            prompt: promptText,
            choices: shuffle([ex.answer, ...ex.choices.filter(c => c !== ex.answer).slice(0, 3)]),
            answer: ex.answer,
            explanation,
        };
    }

    return {
        type: "grammar_fill",
        prompt: promptText,
        answer: ex.answer,
        accept: ex.accept || [ex.answer],
        explanation,
        isFill: true,
    };
}
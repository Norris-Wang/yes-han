
import type { GeneratedQuestion } from "../generators/types";

import {
    MCQuestion,
    FillQuestion,
    OrderQuestion
} from "./QuizCards";

interface QuestionRendererProps {
    question: GeneratedQuestion;
    answered: boolean;
    onAnswer: (correct: boolean) => void;
    questionKey: string | number;
}

export default function QuestionRenderer({
    question,
    answered,
    onAnswer,
    questionKey
}: QuestionRendererProps) {

    switch (question.type) {
        case "vocab_mc_kr2zh":
        case "vocab_mc_zh2kr":
        case "grammar_mc":
            return (
                <MCQuestion
                    key={questionKey}
                    q={question}
                    answered={answered}
                    onAnswer={onAnswer}
                />
            );

        case "vocab_fill":
        case "grammar_fill":
            return (
                <FillQuestion
                    key={questionKey}
                    q={question}
                    answered={answered}
                    onAnswer={onAnswer}
                />
            );

        case "topic_order":
            return (
                <OrderQuestion
                    key={questionKey}
                    q={question}
                    answered={answered}
                    onAnswer={onAnswer}
                />
            );

        default: {
            const neverType: never = question.type;
            throw new Error(
                `未支持的题型：${neverType}`
            );
        }
    }
}
import { z } from "zod";

export const TurnSchema = z.object({
    speaker: z.string(),
    text: z.string(),
    translation: z.string().optional(),
});

export const TopicSchema = z.object({
    id: z.string(),
    title: z.string(),
    turns: z.array(TurnSchema).min(2),
});

export const VocabSchema = z.object({
    id: z.string(),
    word: z.string(),
    meaning: z.string(),
    context: z.string().optional(),
    hint: z.string().optional(),
    tags: z.array(z.string()),
    accept: z.array(z.string()).optional(),
});

export const VocabGroupSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    context: z.string().optional(),
    items: z.array(VocabSchema),
    accept: z.array(z.string()).optional()
});

export const GrammarExampleSchema = z.object({
    sentence: z.string(),
    translation: z.string().optional(),
    focus: z.string(),
    cloze: z.string().optional(),
    answer: z.string(),
    accept: z.array(z.string()).optional(),
    choices: z.array(z.string()).optional(),
    hint: z.string().optional(),
    dictionaryForm: z.string().optional(),
});

export const GrammarSchema = z.object({
    id: z.string(),
    name: z.string(),
    function: z.string(),
    examples: z.array(GrammarExampleSchema),
});

export const LessonSchema = z.object({
    id: z.string(),
    title: z.string(),
    order: z.number(),
    topics: z.array(TopicSchema),
    vocabGroups: z.array(VocabGroupSchema),
    grammars: z.array(GrammarSchema),
});

export const KnowledgeBaseSchema = z.object({
    version: z.string(),
    lessons: z.array(LessonSchema).min(1),
});

export type Turn = z.infer<typeof TurnSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Vocab = z.infer<typeof VocabSchema>;
export type VocabGroup = z.infer<typeof VocabGroupSchema>;
export type GrammarExample = z.infer<typeof GrammarExampleSchema>;
export type Grammar = z.infer<typeof GrammarSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;
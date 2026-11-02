import { parse } from "yaml";
import { KnowledgeBaseSchema, type KnowledgeBase } from "./schema";
import { db, type ReviewDB } from "../db/db";
import { buildUnitsForLesson, type ReviewUnit } from "../review/units";
import { getDefaultSchedulingAlgorithm } from "../review/schedulingConfig";
import type { SchedulingAlgorithm } from "../review/schedulingConfig";
import { assertVocabularyDisambiguation } from "./vocabValidation";

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
    const files: string[] = await fetch(`./data/index.json?t=${Date.now()}`).then(r => r.json());
    const allLessons = [];

    for (const f of files) {
        const text = await fetch(`./data/${f}?t=${Date.now()}`).then(r => r.text());
        const parsed = KnowledgeBaseSchema.parse(parse(text));
        allLessons.push(...parsed.lessons);
    }

    const kb: KnowledgeBase = {
        version: "1.0",
        lessons: allLessons
    };

    assertVocabularyDisambiguation(kb);

    return kb;
}




export async function syncUnitsToDB(
    kb: KnowledgeBase,
    database: ReviewDB = db,
    algorithm: SchedulingAlgorithm =
        getDefaultSchedulingAlgorithm()
): Promise<Record<string, ReviewUnit>> {

    // 在事务外同步生成候选单元
    const generated = kb.lessons.flatMap(
        lesson => buildUnitsForLesson(lesson)
    );

    // 读取旧记录和插入新记录属于同一事务
    return database.transaction(
        "rw",
        database.units,
        async () => {
            const stored =
                await database.units.toArray();

            const map: Record<string, ReviewUnit> = {};

            const storedByKey = new Map(
                stored.map(unit => [unit.key, unit])
            );

            // 只让当前课程中的单元进入学习列表
            for (const unit of generated) {
                const oldUnit = storedByKey.get(unit.key);

                if (oldUnit) {
                    // 已有知识点：保留原学习进度
                    map[unit.key] = oldUnit;
                    continue;
                }

                // 默认算法只作用于真正的新单元
                const newUnit: ReviewUnit = {
                    ...unit,
                    schedulingAlgorithm: algorithm
                };

                await database.units.add(newUnit);

                // 成功插入后记录到本次同步快照
                map[newUnit.key] = newUnit;
            }

            return map;
        }
    );
}
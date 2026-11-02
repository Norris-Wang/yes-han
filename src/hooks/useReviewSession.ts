import { useState, useRef, useCallback, useEffect } from "react";
import type {
    Dispatch,
    SetStateAction
} from "react";

import type { KnowledgeBase } from "../data/schema";

import type { ReviewUnit } from "../review/units";
import { selectSessionUnits, selectDailyUnits } from "../review/selector";
import { getEligibleUnits, getKnowledgeKey } from "../review/progression";
import { buildDailyCandidatePools, type DailyLimits } from "../review/dailyPlanning";

import { generateFor } from "../generators";
import type { GeneratedQuestion } from "../generators/types";

import {
    saveAnswerWithDailyToDb,
    repairDailyRecordToDb,
    type DailyLearningStore
} from "../db/answerService";

import {
    db,
    type ReviewDB
} from "../db/db";

import { Rating, type Grade } from "ts-fsrs";

export type Mode = "due" | "vocab" | "grammar" | "topic" | "mix";


export const DAILY_LIMIT: DailyLimits = {
    vocab: 20,
    grammar: 1,
    topic: 1
};

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getLearnedItemsToday(
    storage: DailyLearningStore
): string[] {
    const key = `kr_learned_items_${getTodayStr()}`;

    try {
        const parsed: unknown = JSON.parse(
            storage.getItem(key) ?? "[]"
        );

        return Array.isArray(parsed) &&
            parsed.every(item => typeof item === "string")
            ? parsed
            : [];
    } catch {
        return [];
    }
}

export function useReviewSession(
    kb: KnowledgeBase | null,
    units: Record<string, ReviewUnit>,
    setUnits: Dispatch<
        SetStateAction<Record<string, ReviewUnit>>
    >,
    options: {
        database?: ReviewDB;
        dailyStore?: DailyLearningStore;
    } = {}
) {
    const database = options.database ?? db;
    const dailyStore = options.dailyStore ?? window.localStorage;

    const [queue, setQueue] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const [current, setCurrent] = useState<{ key: string; unit: ReviewUnit; q: GeneratedQuestion; lastCorrect?: boolean } | null>(null);
    const [answered, setAnswered] = useState(false);
    const [correctCount, setCorrectCount] = useState(0);
    const [answeredCount, setAnsweredCount] = useState(0);
    const [learnedItems, setLearnedItems] =
        useState<string[]>(
            () => getLearnedItemsToday(dailyStore)
        );




    const ensureTodayLearnedItems = useCallback((): string[] => {
        // 每次检查都从当前注入的存储读取，
        // 避免其他标签页更新后继续使用旧数据。
        const todayItems = getLearnedItemsToday(dailyStore);

        // 内容没有变化时，沿用旧状态，
        // 避免无意义的 React 重新渲染。
        setLearnedItems(prev => {
            const unchanged =
                prev.length === todayItems.length &&
                prev.every(
                    (item, index) =>
                        item === todayItems[index]
                );

            return unchanged ? prev : todayItems;
        });

        return todayItems;
    }, [dailyStore]);

    useEffect(() => {
        const check = () => {
            ensureTodayLearnedItems();
        };

        const interval = window.setInterval(check, 30_000);

        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", check);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", check);
        };
    }, [ensureTodayLearnedItems]);

    const autoNextRef = useRef<number | null>(null);
    const nextQuestionRef = useRef<() => void>(() => { });

    const submittingRef = useRef(false);
    const sessionIdRef = useRef(0);
    const sessionPlanRef = useRef<{ mode: Mode; dailyLimits: DailyLimits | null; } | null>(null);
    const latestUnitsRef = useRef(units);

    useEffect(() => {
        latestUnitsRef.current = units;
    }, [units]);

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const [dailyRepair, setDailyRepair] = useState<{
        unitKey: string;
        dayKey: string;
    } | null>(null);

    const [dailyWarning, setDailyWarning] = useState("");

    const [repairingDaily, setRepairingDaily] =
        useState(false);

    const repairingDailyRef = useRef(false);

    const [pendingRating, setPendingRating] = useState<string | null>(null);

    const answerJudgedRef = useRef(false);

    const loadQuestion = useCallback((key: string): boolean => {
        const unit = latestUnitsRef.current[key];
        if (!unit || !kb) return false;
        const q = generateFor(kb, unit);
        if (!q) return false;
        answerJudgedRef.current = false;
        setPendingRating(null);
        setCurrent({ key, unit, q, lastCorrect: undefined });
        setAnswered(false);
        return true;
    }, [kb]);


    const nextQuestion = useCallback(() => {
        if (
            submittingRef.current ||
            pendingRating !== null ||
            dailyRepair !== null ||
            repairingDailyRef.current
        ) {
            return;
        }

        if (autoNextRef.current !== null) {
            window.clearTimeout(autoNextRef.current);
            autoNextRef.current = null;
        }

        // 第一阶段：优先完成原队列。
        let nextIdx = index + 1;

        while (nextIdx < queue.length) {
            if (loadQuestion(queue[nextIdx])) {
                setIndex(nextIdx);
                return;
            }

            nextIdx++;
        }

        // 第二阶段：队列耗尽后重新检查新解锁的题目。
        const plan = sessionPlanRef.current;

        if (plan) {
            const allUnits = Object.values(
                latestUnitsRef.current
            );

            // 同一个会话中，同一复习单元只安排一次。
            const alreadyQueued = new Set(queue);

            // 与 App.tsx 保持相同的词汇方向过滤规则。
            const completedFillKeys = new Set(
                allUnits
                    .filter(unit => {
                        if (
                            unit.itemType !== "vocab" ||
                            unit.direction !== "fill"
                        ) {
                            return false;
                        }

                        const algorithm =
                            unit.schedulingAlgorithm ?? "fixed";

                        return algorithm === "fsrs"
                            ? unit.seen > 0 &&
                            unit.seen > unit.lapses
                            : unit.stage >= 1;
                    })
                    .map(getKnowledgeKey)
            );

            const isAnswerable = (
                unit: ReviewUnit
            ): boolean =>
                !(
                    unit.itemType === "vocab" &&
                    unit.direction !== "fill" &&
                    completedFillKeys.has(
                        getKnowledgeKey(unit)
                    )
                );

            let extra: ReviewUnit[];

            if (plan.mode === "due") {
                // 今日复习：继续遵守每日目标。
                // 先在完整数据上计算配额，
                // 然后排除本次会话已安排的题目。
                const pools = buildDailyCandidatePools(
                    allUnits,
                    getLearnedItemsToday(dailyStore),
                    isAnswerable,
                    plan.dailyLimits
                );

                extra = selectDailyUnits({
                    due: pools.due.filter(
                        unit => !alreadyQueued.has(unit.key)
                    ),
                    progression: pools.progression.filter(
                        unit => !alreadyQueued.has(unit.key)
                    ),
                    fresh: pools.fresh.filter(
                        unit => !alreadyQueued.has(unit.key)
                    )
                });
            } else {
                // 其他模式：保留原有的题型过滤规则。
                const eligible = getEligibleUnits(
                    allUnits.filter(isAnswerable)
                ).filter(
                    unit => !alreadyQueued.has(unit.key)
                );

                const pool = eligible.filter(
                    unit =>
                        plan.mode === "mix" ||
                        unit.itemType === plan.mode
                );

                extra = selectSessionUnits(
                    pool,
                    plan.mode
                );
            }

            // 追加新题目，并立即加载第一道有效题目。
            const extraKeys = extra.map(unit => unit.key);

            for (
                let offset = 0;
                offset < extraKeys.length;
                offset++
            ) {
                if (loadQuestion(extraKeys[offset])) {
                    const base = queue.length;

                    setQueue(prev => [
                        ...prev,
                        ...extraKeys
                    ]);

                    setIndex(base + offset);
                    return;
                }
            }
        }

        // 第三阶段：确实没有可选题目，才结束。
        sessionPlanRef.current = null;
        setCurrent(null);

    }, [
        index,
        queue,
        loadQuestion,
        pendingRating,
        dailyRepair,
        dailyStore
    ]);

    useEffect(() => {
        nextQuestionRef.current = nextQuestion;
    }, [nextQuestion]);



    const commitAnswer = useCallback(
        async (correct: boolean, rating?: Grade) => {
            if (
                !current ||
                answered ||
                submittingRef.current ||
                dailyRepair !== null
            ) {
                return;
            }

            const sessionId = sessionIdRef.current;
            const { key, q } = current;

            submittingRef.current = true;
            setSaving(true);
            setSaveError("");

            try {
                // 一把独占锁覆盖数据库事务和每日记录写入。
                const { updated, daily } =
                    await saveAnswerWithDailyToDb(
                        database,
                        dailyStore,
                        key,
                        correct,
                        q.type,
                        Date.now(),
                        rating
                    );

                latestUnitsRef.current = {
                    ...latestUnitsRef.current,
                    [key]: updated
                };

                setUnits((prev: Record<string, ReviewUnit>) => ({
                    ...prev,
                    [key]: updated
                }));

                if (sessionId !== sessionIdRef.current) {
                    return;
                }

                if (daily.items !== null) {
                    setLearnedItems(daily.items);
                }

                if (daily.status === "failed") {
                    setDailyRepair({
                        unitKey: key,
                        dayKey: daily.dayKey
                    });

                    setDailyWarning(
                        "答案已经保存，但今日学习统计更新失败。" +
                        "请只修复每日记录，不要重新作答。" +
                        (daily.error
                            ? ` 原因：${daily.error}`
                            : "")
                    );
                } else {
                    setDailyRepair(null);
                    setDailyWarning("");
                }

                // 数据库成功即代表本次答题完成。
                setPendingRating(null);
                setAnswered(true);
                setAnsweredCount(count => count + 1);

                if (correct) {
                    setCorrectCount(count => count + 1);
                }

                setCurrent(prev =>
                    prev?.key === key
                        ? { ...prev, lastCorrect: correct }
                        : prev
                );

                // 如果每日记录需要修复，先留在当前题目。
                if (correct && daily.status !== "failed") {
                    if (autoNextRef.current !== null) {
                        window.clearTimeout(autoNextRef.current);
                    }

                    autoNextRef.current =
                        window.setTimeout(() => {
                            autoNextRef.current = null;
                            nextQuestionRef.current();
                        }, 900);
                }

            } catch (error) {
                // 只有保存服务抛错，才进入数据库保存失败分支。
                console.error("答题保存请求失败：", error);

                if (sessionId === sessionIdRef.current) {
                    setSaveError(
                        "答题保存未确认成功，请检查错误后再重试。"
                    );

                    if (pendingRating === null) {
                        answerJudgedRef.current = false;
                    }
                }

            } finally {
                submittingRef.current = false;

                if (sessionId === sessionIdRef.current) {
                    setSaving(false);
                }
            }
        },
        [
            current,
            answered,
            pendingRating,
            dailyRepair,
            database,
            dailyStore,
            setUnits
        ]
    );


    const repairDaily = useCallback(async () => {
        if (
            !dailyRepair ||
            repairingDailyRef.current ||
            submittingRef.current
        ) {
            return;
        }

        const request = dailyRepair;
        const sessionId = sessionIdRef.current;

        repairingDailyRef.current = true;
        setRepairingDaily(true);

        try {
            // 不执行 FSRS 调度，不新增答题日志。
            const result = await repairDailyRecordToDb(
                database,
                dailyStore,
                request.unitKey,
                request.dayKey
            );

            if (sessionId !== sessionIdRef.current) {
                return;
            }

            if (
                result.status === "written" ||
                result.status === "already_present"
            ) {
                if (result.items !== null) {
                    setLearnedItems(result.items);
                }

                setDailyRepair(null);
                setDailyWarning("");

                // 原题已正确保存时，修复后恢复自动跳题。
                if (
                    current?.key === request.unitKey &&
                    current.lastCorrect === true
                ) {
                    if (autoNextRef.current !== null) {
                        window.clearTimeout(autoNextRef.current);
                    }

                    autoNextRef.current =
                        window.setTimeout(() => {
                            autoNextRef.current = null;
                            nextQuestionRef.current();
                        }, 900);
                }

                return;
            }

            setDailyWarning(
                "答案已保存，但每日统计修复仍然失败。" +
                "请不要重新提交答案。" +
                (result.error ? ` ${result.error}` : "")
            );

        } catch (error) {
            if (sessionId === sessionIdRef.current) {
                setDailyWarning(
                    "答案已保存，但每日统计暂时无法修复：" +
                    (error instanceof Error
                        ? error.message
                        : String(error))
                );
            }

        } finally {
            repairingDailyRef.current = false;

            if (sessionId === sessionIdRef.current) {
                setRepairingDaily(false);
            }
        }
    }, [
        current,
        dailyRepair,
        database,
        dailyStore
    ]);

    const handleAnswer = useCallback(
        (correct: boolean) => {
            if (
                !current ||
                answered ||
                answerJudgedRef.current ||
                submittingRef.current
            ) {
                return;
            }

            // 同步锁定，避免一次作答重复判定
            answerJudgedRef.current = true;

            const algorithm =
                current.unit.schedulingAlgorithm ?? "fixed";

            // FSRS 答对：暂不保存，等待用户评分
            if (algorithm === "fsrs" && correct) {
                setPendingRating(current.key);
                return;
            }

            // FSRS 答错：直接按 Again 保存
            // fixed：仍然使用原有自动保存方式
            void commitAnswer(
                correct,
                algorithm === "fsrs"
                    ? Rating.Again
                    : undefined
            );
        },
        [current, answered, commitAnswer]
    );


    const confirmRating = useCallback(
        (rating: Grade) => {
            if (
                !current ||
                pendingRating !== current.key ||
                !answerJudgedRef.current ||
                submittingRef.current
            ) {
                return;
            }

            // 答对后只能选择 Hard / Good / Easy
            if (
                rating !== Rating.Hard &&
                rating !== Rating.Good &&
                rating !== Rating.Easy
            ) {
                return;
            }

            void commitAnswer(true, rating);
        },
        [current, pendingRating, commitAnswer]
    );


    const startSession = useCallback((
        mode: Mode,
        allUnits: ReviewUnit[],
        isAnswerable: (u: ReviewUnit) => boolean,
        dailyLimits: DailyLimits | null = DAILY_LIMIT
    ) => {
        // 数据库保存或每日记录修复期间，
        // 禁止启动新的答题会话。
        if (
            submittingRef.current ||
            repairingDailyRef.current
        ) {
            return false;
        }

        // 不能通过重新开始会话丢弃待修复提示。
        if (dailyRepair !== null) {
            alert("请先修复尚未完成的每日学习统计。");
            return false;
        }

        const todayLearned = ensureTodayLearnedItems();

        sessionIdRef.current += 1;
        answerJudgedRef.current = false;
        sessionPlanRef.current = null;
        setPendingRating(null);

        setSaving(false);
        setSaveError("");

        if (autoNextRef.current !== null) {
            window.clearTimeout(autoNextRef.current);
            autoNextRef.current = null;
        }

        const eligibleUnits = getEligibleUnits(
            allUnits.filter(isAnswerable)
        );

        let pool = eligibleUnits;
        if (mode === "vocab") pool = eligibleUnits.filter(u => u.itemType === "vocab" && isAnswerable(u));
        else if (mode === "grammar") pool = eligibleUnits.filter(u => u.itemType === "grammar" && isAnswerable(u));
        else if (mode === "topic") pool = eligibleUnits.filter(u => u.itemType === "topic" && isAnswerable(u));
        else if (mode === "due") {
            const pools = buildDailyCandidatePools(
                allUnits,
                todayLearned,
                isAnswerable,
                dailyLimits
            );

            const dailySelected = selectDailyUnits(pools);

            if (dailySelected.length === 0) {
                alert("今日复习任务已完成 🎉\n明天再来吧！");
                return false;
            }

            pool = dailySelected;
        } else if (mode === "mix") {
            pool = eligibleUnits.filter(isAnswerable);
        }

        if (pool.length === 0) { alert("没有可复习的题目。"); return false; }

        // 每日复习：到期优先、题型平衡、新知识补位
        // 其他模式：按题型平衡选择
        const selected =
            mode === "due"
                ? pool
                : selectSessionUnits(
                    pool,
                    mode
                );

        // 仅在开发环境中输出选题结果
        if (import.meta.env.DEV) {
            console.table(
                selected.map((u, index) => ({
                    no: index + 1,
                    lesson: u.lessonId,
                    type: u.itemType,
                    itemId: u.itemId,
                    direction: u.direction,
                    seen: u.seen,
                    stage: u.stage,
                    dueAt: new Date(u.dueAt).toLocaleString()
                }))
            );
        }

        const keys = selected.map(u => u.key);

        setQueue(keys);
        setIndex(0);
        setCorrectCount(0);
        setAnsweredCount(0);

        let startIdx = 0;

        while (startIdx < keys.length) {
            if (loadQuestion(keys[startIdx])) {
                sessionPlanRef.current = {
                    mode,
                    dailyLimits
                };

                setIndex(startIdx);
                return true;
            }

            startIdx++;
        }

        setCurrent(null);
        setQueue([]);
        setIndex(0);

        alert("当前没有可生成的题目，请检查课程数据。");

        return false;
    }, [loadQuestion, ensureTodayLearnedItems, dailyRepair]);

    const endSession = useCallback(() => {
        sessionPlanRef.current = null;
        sessionIdRef.current += 1;
        answerJudgedRef.current = false;
        setPendingRating(null);

        if (autoNextRef.current !== null) {
            window.clearTimeout(autoNextRef.current);
        }

        autoNextRef.current = null;

        setQueue([]);
        setIndex(0);
        setCurrent(null);
        setAnswered(false);

        setSaving(false);
        setSaveError("");
    }, []);

    return {
        queue, index, current, answered, correctCount, answeredCount,
        startSession, handleAnswer, nextQuestion, endSession,
        learnedItems, setLearnedItems,
        saving, saveError,
        pendingRating, confirmRating,
        dailyRepair,
        dailyWarning,
        repairingDaily,
        repairDaily,
        answerLocked:
            answered ||
            saving ||
            repairingDaily ||
            pendingRating !== null ||
            dailyRepair !== null,
    };
}
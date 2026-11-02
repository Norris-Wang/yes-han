import { useEffect, useState, useRef } from "react";

import { db, type ReviewDB } from "../db/db";
import { saveAnswerToDb } from "../db/answerService";

import type { ReviewUnit } from "../review/units";
import { buildUnitsForLesson } from "../review/units";

import type { KnowledgeBase } from "../data/schema";

import type { GeneratedQuestion } from "../generators/types";
import { generateFor } from "../generators";

import QuestionRenderer from "../components/QuestionRenderer";

import { Rating, type Grade } from "ts-fsrs";

type SaveAnswerFn = typeof saveAnswerToDb;

interface WrongItem {
    unitKey: string;
    unit: ReviewUnit | null;
    wrongCount: number;
    lastAt: number;
    lastType: string;
}

export default function WrongBook({
    kb,
    onBack,
    database = db,
    saveAnswerFn = saveAnswerToDb,
    readOnly = false
}: {
    kb: KnowledgeBase;
    onBack: () => void;
    database?: ReviewDB;
    saveAnswerFn?: SaveAnswerFn;
    readOnly?: boolean;
}) {
    const [items, setItems] = useState<WrongItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [reviewing, setReviewing] = useState<{ key: string; q: GeneratedQuestion } | null>(null);
    const [feedback, setFeedback] = useState<{ correct: boolean; answer: string } | null>(null);

    const submittingRef = useRef(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");

    const [pendingRating, setPendingRating] = useState(false);
    const pendingAnswerRef = useRef<{ key: string; correct: boolean; rating?: Grade; } | null>(null);
    const answerJudgedRef = useRef(false);

    const reviewTokenRef = useRef(0);
    const [answerLocked, setAnswerLocked] = useState(false);

    useEffect(() => { load(); }, []);


    async function load() {
        setLoading(true);

        try {
            const [logs, units] = await Promise.all([
                database.logs.toArray(),
                database.units.toArray()
            ]);

            const unitMap = new Map(
                units.map(u => [u.key, u])
            );

            // 记录每个复习单元的最后一次答题
            // 同时保留历史错误次数
            const history = new Map<
                string,
                {
                    wrongCount: number;
                    lastWrongAt: number;
                    lastType: string;
                    lastLogId: number;
                    lastCorrect: boolean;
                    lastAt: number;
                }
            >();

            for (const log of logs) {
                const existing = history.get(log.unitKey);

                if (!existing) {
                    history.set(log.unitKey, {
                        wrongCount: log.correct ? 0 : 1,
                        lastWrongAt: log.correct ? 0 : log.at,
                        lastType: log.type,
                        lastLogId: log.id ?? 0,
                        lastCorrect: log.correct,
                        lastAt: log.at,
                    });
                    continue;
                }

                if (!log.correct) {
                    existing.wrongCount++;
                    existing.lastWrongAt = Math.max(
                        existing.lastWrongAt,
                        log.at
                    );
                }

                // at 相同时，使用自增日志 ID 判断先后
                const id = log.id ?? 0;

                if (
                    log.at > existing.lastAt ||
                    (
                        log.at === existing.lastAt &&
                        id > existing.lastLogId
                    )
                ) {
                    existing.lastCorrect = log.correct;
                    existing.lastType = log.type;
                    existing.lastLogId = id;
                    existing.lastAt = log.at;
                }
            }

            const activeUnitKeys = new Set(
                kb.lessons
                    .flatMap(buildUnitsForLesson)
                    .map(unit => unit.key)
            );

            const list: WrongItem[] = [];

            for (const [unitKey, record] of history) {
                // 过滤已经不属于当前课程的旧题
                if (!activeUnitKeys.has(unitKey)) {
                    continue;
                }
                // 没有错误，或者最后一次已经答对
                if (
                    record.wrongCount === 0 ||
                    record.lastCorrect
                ) {
                    continue;
                }

                list.push({
                    unitKey,
                    unit: unitMap.get(unitKey) ?? null,
                    wrongCount: record.wrongCount,
                    lastAt: record.lastWrongAt,
                    lastType: record.lastType
                });
            }

            list.sort((a, b) => b.lastAt - a.lastAt);

            setItems(list);
        } catch (error) {
            console.error("错题本加载失败：", error);
            setSaveError("错题本加载失败，请重新进入页面。");
        } finally {
            setLoading(false);
        }
    }

    function describe(item: WrongItem): string {
        if (!item.unit) return item.unitKey;
        const lesson = kb.lessons.find(l => l.id === item.unit!.lessonId);
        if (!lesson) return item.unitKey;

        if (item.unit.itemType === "vocab") {
            for (const g of lesson.vocabGroups) {
                const v = g.items.find(x => x.id === item.unit!.itemId);
                if (v) {
                    const dirLabel = item.unit.direction === "kr2zh" ? "韩→中"
                        : item.unit.direction === "zh2kr" ? "中→韩" : "拼写";
                    return `${v.word}（${v.meaning}）· ${dirLabel}`;
                }
            }
        }
        if (item.unit.itemType === "grammar") {
            const g = lesson.grammars.find(x => x.id === item.unit!.itemId);
            if (g) {
                const dirLabel = item.unit.direction === "mc" ? "形式选择" : "填空";
                return `${g.name} · ${dirLabel}`;
            }
        }
        if (item.unit.itemType === "topic") {
            const t = lesson.topics.find(x => x.id === item.unit!.itemId);
            if (t) return `${t.title}`;
        }
        return item.unitKey;
    }

    function startReview(item: WrongItem) {
        if (readOnly) return;
        if (submittingRef.current) return;

        submittingRef.current = false;
        setSaveError("");

        if (!item.unit) return;
        const q = generateFor(kb, item.unit);
        if (!q) return;
        setReviewing({ key: item.unitKey, q });
        answerJudgedRef.current = false;
        pendingAnswerRef.current = null;
        reviewTokenRef.current += 1;

        setAnswerLocked(false);

        setPendingRating(false);
        setSaveError("");
        setFeedback(null);
    }

    async function commitWrongAnswer(
        correct: boolean,
        rating?: Grade
    ) {
        if (readOnly) return;
        if (
            !reviewing ||
            feedback ||
            submittingRef.current
        ) {
            return;
        }

        const { key, q } = reviewing;

        submittingRef.current = true;
        setSaving(true);
        setSaveError("");

        try {
            // 真正写入数据库
            await saveAnswerFn(
                database,
                key,
                correct,
                q.type,
                Date.now(),
                rating
            );

            // 只有保存成功才更新 UI
            setFeedback({
                correct,
                answer: q.answer
            });

            setPendingRating(false);
            pendingAnswerRef.current = null;

            // 正确作答后从错题列表移除
            if (correct) {
                setItems(prev =>
                    prev.filter(
                        item => item.unitKey !== key
                    )
                );
            }

        } catch (error) {
            console.error(
                "错题保存失败：",
                error
            );

            setSaveError(
                "保存失败，请重新提交本次评分。"
            );

        } finally {
            submittingRef.current = false;
            setSaving(false);
        }
    }


    async function handleAnswer(correct: boolean) {
        if (readOnly) return;
        if (
            !reviewing ||
            feedback ||
            answerJudgedRef.current ||
            submittingRef.current
        ) {
            return;
        }

        answerJudgedRef.current = true;

        const token = reviewTokenRef.current;
        setAnswerLocked(true);
        setSaving(true);
        setSaveError("");

        let unit: ReviewUnit | undefined;

        try {
            unit = await database.units.get(reviewing.key);
        } catch (error) {
            console.error("读取复习单元失败", error);

            if (token === reviewTokenRef.current) {
                setSaveError("读取失败，请返回后重试。");
            }
            return;
        } finally {
            if (token === reviewTokenRef.current) {
                setSaving(false);
            }
        }

        if (token !== reviewTokenRef.current) return;

        if (!unit) {
            setSaveError("找不到复习单元，请返回后重试。");
            return;
        }

        const algorithm = unit.schedulingAlgorithm ?? "fixed";
        console.log("当前错题算法：", reviewing.key, algorithm);

        // FSRS 回答正确：等待用户选择评分
        if (algorithm === "fsrs" && correct) {
            pendingAnswerRef.current = {
                key: reviewing.key,
                correct: true
            };

            setPendingRating(true);
            return;
        }

        // 固定算法：直接保存
        // FSRS 回答错误：按 Again 保存
        const rating =
            algorithm === "fsrs"
                ? Rating.Again
                : undefined;

        pendingAnswerRef.current = {
            key: reviewing.key,
            correct,
            rating
        };

        await commitWrongAnswer(
            correct,
            rating
        );
    }


    async function confirmWrongRating(rating: Grade) {
        if (readOnly) return;
        if (
            !reviewing ||
            !pendingRating ||
            submittingRef.current ||
            feedback
        ) {
            return;
        }

        const pending = pendingAnswerRef.current;

        if (
            !pending ||
            pending.key !== reviewing.key ||
            !pending.correct
        ) {
            return;
        }

        // 正确答案只能选择这三个评分
        if (
            rating !== Rating.Hard &&
            rating !== Rating.Good &&
            rating !== Rating.Easy
        ) {
            return;
        }

        await commitWrongAnswer(true, rating);
    }


    async function retryWrongAnswer() {
        if (readOnly) return;
        const pending = pendingAnswerRef.current;

        if (
            !reviewing ||
            !pending ||
            pending.key !== reviewing.key ||
            submittingRef.current ||
            saving ||
            feedback ||
            pendingRating
        ) {
            return;
        }

        await commitWrongAnswer(
            pending.correct,
            pending.rating
        );
    }

    async function returnToWrongList() {
        if (saving || submittingRef.current) return;

        reviewTokenRef.current += 1;
        answerJudgedRef.current = false;
        pendingAnswerRef.current = null;

        setPendingRating(false);
        setAnswerLocked(false);
        setReviewing(null);
        setFeedback(null);
        setSaveError("");

        await load();
    }

    if (loading) return <div className="app"><p>加载中…</p></div>;

    if (reviewing) {
        const { q } = reviewing;
        return (
            <div className="app">
                <header>
                    <h1>错题重做</h1>
                    <button className="btn secondary"
                        style={{ width: "auto", padding: "8px 14px", fontSize: 14, margin: 0 }}
                        disabled={saving}
                        onClick={() => void returnToWrongList()}
                    >
                        返回
                    </button>

                    {saving && (
                        <p role="status">
                            正在保存答题结果…
                        </p>
                    )}

                    {saveError && (
                        <p role="alert" style={{ color: "#d93025" }}>
                            {saveError}
                        </p>
                    )}

                    {saveError &&
                        pendingAnswerRef.current &&
                        !pendingRating && (
                            <button
                                className="btn secondary"
                                disabled={saving}
                                onClick={retryWrongAnswer}
                            >
                                重新保存本次答案
                            </button>
                        )}
                </header>
                <div className="card">
                    <QuestionRenderer
                        question={q}
                        questionKey={reviewing.key}
                        answered={
                            readOnly ||
                            answerLocked ||
                            saving ||
                            pendingRating ||
                            !!feedback
                        }
                        onAnswer={handleAnswer}
                    />
                </div>


                {pendingRating && !feedback && (
                    <div className="card">
                        <div className="feedback ok">
                            ✅ 回答正确！
                        </div>

                        <p style={{ marginTop: 14 }}>
                            这次回忆对你来说有多难？
                        </p>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, 1fr)",
                                gap: 10
                            }}
                        >
                            <button
                                className="btn secondary"
                                disabled={saving}
                                onClick={() =>
                                    void confirmWrongRating(Rating.Hard)
                                }
                            >
                                Hard
                                <small style={{ display: "block" }}>
                                    有点吃力
                                </small>
                            </button>

                            <button
                                className="btn"
                                disabled={saving}
                                onClick={() =>
                                    void confirmWrongRating(Rating.Good)
                                }
                            >
                                Good
                                <small style={{ display: "block" }}>
                                    正常回忆
                                </small>
                            </button>

                            <button
                                className="btn secondary"
                                disabled={saving}
                                onClick={() =>
                                    void confirmWrongRating(Rating.Easy)
                                }
                            >
                                Easy
                                <small style={{ display: "block" }}>
                                    非常轻松
                                </small>
                            </button>
                        </div>

                        <p style={{
                            color: "#86868b",
                            fontSize: 12,
                            marginTop: 10
                        }}>
                            选择评分后才会保存这次复习。
                        </p>
                    </div>
                )}

                {feedback && (
                    <div className="card">
                        <div className={`feedback ${feedback.correct ? "ok" : "bad"}`}>
                            {feedback.correct ? "✅ 正确！已从错题本移除。" : `❌ 错误。正确答案：${feedback.answer}`}
                        </div>
                        <p style={{ fontSize: 14, color: "#86868b", whiteSpace: "pre-wrap", marginTop: 12 }}>
                            {q.explanation}
                        </p>
                        <button className="btn" style={{ marginTop: 14 }}
                            onClick={() => void returnToWrongList()}
                            disabled={saving}>
                            返回错题本
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // 将错题按类型分组
    const vocabItems = items.filter(i => i.unit?.itemType === "vocab");
    const grammarItems = items.filter(i => i.unit?.itemType === "grammar");
    const topicItems = items.filter(i => i.unit?.itemType === "topic");

    // 提取出的单块列表渲染组件
    const renderSection = (title: string, sectionItems: WrongItem[]) => {
        if (sectionItems.length === 0) return null;
        return (
            <div className="card" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <h2 style={{ fontSize: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f0f0f0", paddingBottom: 12 }}>
                    <span>{title}</span>
                    <span style={{ fontSize: 13, color: "#86868b", fontWeight: "normal" }}>{sectionItems.length} 项</span>
                </h2>

                {/* 内部滚动区域，防止错题太多撑破页面 */}
                <div style={{ overflowY: "auto", flex: 1, paddingRight: 4, maxHeight: "60vh" }}>
                    {sectionItems.map(item => (
                        <div
                            key={item.unitKey}
                            className="topic-turn"
                            style={{ cursor: "pointer", marginBottom: 10, border: "1px solid #f0f0f0" }}
                            onClick={() => {
                                if (!readOnly) startReview(item);
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={describe(item)}>
                                    {describe(item)}
                                </div>
                                <div style={{ fontSize: 12, color: "#ff3b30" }}>
                                    错 {item.wrongCount} 次 · 最近 {new Date(item.lastAt).toLocaleDateString()}
                                </div>
                            </div>
                            <span style={{ color: "#007aff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", marginLeft: 8 }}>{readOnly ? "仅查看" : "重做 →"}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="app" style={{ maxWidth: 1100 }}> {/* 放宽了最大宽度 */}
            <header>
                <div>
                    <h1>错题本</h1>
                    <p className="subtitle">按知识点分类复习</p>
                </div>
                <button
                    className="btn secondary"
                    style={{ width: "auto", padding: "8px 16px", fontSize: 14, margin: 0 }}
                    onClick={onBack}
                >
                    返回面板
                </button>
            </header>

            {items.length === 0 ? (
                <div className="card" style={{ textAlign: "center", color: "#86868b", padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
                    <p>暂无错题，继续保持！</p>
                </div>
            ) : (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    gap: 20,
                    alignItems: "start"
                }}>
                    {renderSection("词汇", vocabItems)}
                    {renderSection("语法", grammarItems)}
                    {renderSection("对话", topicItems)}
                </div>
            )}
        </div>
    );
}

import { useEffect, useState, useMemo } from "react";

import { type KnowledgeBase } from "./data/schema";
import { loadKnowledgeBase, syncUnitsToDB } from "./data/loader";

import {
    buildUnitsForLesson,
    type ReviewUnit
} from "./review/units";
import { getDefaultSchedulingAlgorithm } from "./review/schedulingConfig";
import { Rating } from "./review/fsrsScheduler";
import { getKnowledgeKey } from "./review/progression";
import { buildDailyCandidatePools } from "./review/dailyPlanning";
import { selectDailyUnits } from "./review/selector";

import { db } from "./db/db";
import { withLearningWriteLock } from "./db/learningWriteGate";
import {
    isLearningStorageKey,
    exportLearningBackup,
    downloadLearningBackup
} from "./db/backupService";

import Dashboard from "./pages/Dashboard";
import WrongBook from "./pages/WrongBook";
import PracticeLab from "./pages/PracticeLab";
import WrongBookSandbox from "./pages/WrongBookSandbox";

import QuestionRenderer from "./components/QuestionRenderer";

import { useReviewSession, DAILY_LIMIT } from "./hooks/useReviewSession";

type View =
    | "home"
    | "quiz"
    | "summary"
    | "wrongbook"
    | "practice";



export default function App() {
    const [kb, setKb] = useState<KnowledgeBase | null>(null);
    const [units, setUnits] = useState<Record<string, ReviewUnit>>({});
    const [view, setView] = useState<View>("home");
    const [error, setError] = useState("");

    useEffect(() => {
        loadKnowledgeBase()
            .then(async (k) => {
                setKb(k);
                const syncedUnits = await syncUnitsToDB(k);
                setUnits(syncedUnits);
            })
            .catch(e => setError("加载失败：" + e.message));
    }, []);

    const allUnits = Object.values(units);


    const completedFillKeys = useMemo(() => {
        const completed = new Set<string>();

        for (const unit of Object.values(units)) {
            if (
                unit.itemType !== "vocab" ||
                unit.direction !== "fill"
            ) {
                continue;
            }

            // 固定算法保持原有 stage >= 1 的行为
            const algorithm =
                unit.schedulingAlgorithm ?? "fixed";

            const completedFill =
                algorithm === "fsrs"
                    ? unit.seen > 0 &&
                    unit.seen > unit.lapses
                    : unit.stage >= 1;

            if (completedFill) {
                completed.add(getKnowledgeKey(unit));
            }
        }

        return completed;
    }, [units]);


    const isAnswerable = (unit: ReviewUnit) => {
        if (
            unit.itemType === "vocab" &&
            unit.direction !== "fill" &&
            completedFillKeys.has(getKnowledgeKey(unit))
        ) {
            return false;
        }

        return true;
    };

    const session = useReviewSession(kb, units, setUnits);




    const dailyPools = buildDailyCandidatePools(
        allUnits,
        session.learnedItems,
        isAnswerable,
        DAILY_LIMIT
    );

    const dailySelected = selectDailyUnits(dailyPools);

    const dueKeys = new Set(
        dailyPools.due.map(unit => unit.key)
    );

    const progressionKeys = new Set(
        dailyPools.progression.map(unit => unit.key)
    );

    const dueCount = dailySelected.filter(unit =>
        dueKeys.has(unit.key)
    ).length;

    const progressionCount = dailySelected.filter(unit =>
        progressionKeys.has(unit.key)
    ).length;

    const actualNewUnitCount =
        dailySelected.length -
        dueCount -
        progressionCount;


    const displayView: View =
        view === "quiz" &&
            !session.current &&
            session.answeredCount > 0
            ? "summary"
            : view;

    if (error) return <div style={{ padding: 40, color: "red" }}>{error}</div>;
    if (!kb) return <div style={{ padding: 40 }}>加载中…</div>;

    if (
        import.meta.env.DEV &&
        new URLSearchParams(
            window.location.search
        ).has("wrongbook-test")
    ) {
        return <WrongBookSandbox kb={kb} />;
    }



    const dailyRepairPanel = session.dailyRepair ? (
        <div className="card">
            <p role="alert" style={{ color: "#a65d00" }}>
                ⚠️ {session.dailyWarning}
            </p>

            <p style={{ fontSize: 13, marginTop: 10 }}>
                答题数据库已经保存成功。
                修复只会更新每日学习记录，不会再次提交答案。
            </p>

            <button
                className="btn secondary"
                style={{ marginTop: 12 }}
                disabled={
                    session.repairingDaily ||
                    session.saving
                }
                onClick={() => void session.repairDaily()}
            >
                {session.repairingDaily
                    ? "正在修复…"
                    : "修复今日学习统计"}
            </button>
        </div>
    ) : null;

    if (displayView === "home") {
        return (
            <>
                <Dashboard
                    kb={kb}
                    units={units}
                    dueReviewCount={dueCount}
                    newUnitCount={actualNewUnitCount}
                    onStart={(mode) => {
                        const started = session.startSession(
                            mode,
                            allUnits,
                            isAnswerable
                        );

                        if (started) {
                            setView("quiz");
                        }
                    }}
                    onWrongBook={() => setView("wrongbook")}
                    onPractice={() => setView("practice")}


                    onReset={async () => {
                        // 正在保存或修复每日统计时，不允许重置。
                        if (
                            session.saving ||
                            session.repairingDaily ||
                            session.dailyRepair
                        ) {
                            alert("请先完成当前保存或每日统计修复。");
                            return;
                        }

                        // 先在数据库事务外生成全部新单元。
                        // 这与 syncUnitsToDB() 创建新单元的规则一致。
                        const algorithm = getDefaultSchedulingAlgorithm();

                        const freshUnits: ReviewUnit[] = kb.lessons
                            .flatMap(lesson => buildUnitsForLesson(lesson))
                            .map(unit => ({
                                ...unit,
                                schedulingAlgorithm: algorithm
                            }));

                        const freshUnitMap: Record<string, ReviewUnit> = {};

                        for (const unit of freshUnits) {
                            freshUnitMap[unit.key] = unit;
                        }

                        // 提前收集需要清理的每日学习记录。
                        // 不触碰其他 localStorage 数据。
                        const keysToRemove: string[] = [];

                        try {
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);

                                if (key && isLearningStorageKey(key)) {
                                    keysToRemove.push(key);
                                }
                            }
                        } catch (error) {
                            console.error("读取每日学习记录失败：", error);
                            alert("无法读取每日学习记录，已取消重置。");
                            return;
                        }

                        const failedStorageKeys: string[] = [];

                        try {
                            await withLearningWriteLock(db.name, async () => {
                                await db.transaction(
                                    "rw",
                                    db.units,
                                    db.logs,
                                    async () => {
                                        await db.units.clear();
                                        await db.logs.clear();
                                        await db.units.bulkAdd(freshUnits);
                                    }
                                );

                                for (const key of keysToRemove) {
                                    try {
                                        localStorage.removeItem(key);
                                    } catch (error) {
                                        console.error(
                                            "清理每日学习记录失败：",
                                            key,
                                            error
                                        );
                                        failedStorageKeys.push(key);
                                    }
                                }
                            });
                        } catch (error) {
                            console.error("重置学习进度失败：", error);

                            alert(
                                "重置未完成：数据库事务已回滚或尚未开始，" +
                                "请检查控制台错误。"
                            );
                            return;
                        }

                        setUnits(freshUnitMap);
                        session.setLearnedItems([]);

                        if (failedStorageKeys.length > 0) {
                            alert(
                                "数据库已重置，但有 " +
                                failedStorageKeys.length +
                                " 项每日学习记录清理失败。" +
                                "请不要继续答题，先检查浏览器存储。"
                            );
                        }
                    }}

                    onExportBackup={async () => {
                        // 不允许在答题保存或统计修复期间导出。
                        if (session.saving || session.repairingDaily) {
                            throw new Error("请等待当前保存操作完成。");
                        }

                        const backup = await exportLearningBackup(
                            db,
                            window.localStorage
                        );

                        downloadLearningBackup(backup);
                    }}

                />
                {dailyRepairPanel}
            </>
        );
    }

    if (displayView === "wrongbook") {
        return (
            <WrongBook
                kb={kb}
                onBack={() => {
                    void syncUnitsToDB(kb)
                        .then(latestUnits => {
                            setUnits(latestUnits);
                            setView("home");
                        })
                        .catch(error => {
                            console.error(
                                "刷新学习进度失败：",
                                error
                            );
                            setError(
                                "刷新学习进度失败，请重新加载页面。"
                            );
                        });
                }}
            />
        );
    }

    if (displayView === "practice") {
        return (
            <PracticeLab
                kb={kb}
                onBack={() => setView("home")}
            />
        );
    }

    if (displayView === "quiz") {
        // 👇 兜底：如果因为某种原因没有题目了，不要白屏
        if (!session.current) {
            return (
                <div className="app">
                    <div className="card" style={{ textAlign: "center", marginTop: 40 }}>
                        <h2>没有可用的题目</h2>
                        <p style={{ color: "#86868b", margin: "16px 0" }}>可能是因为数据异常或已完成。</p>
                        <button className="btn" onClick={() => setView("home")}>返回面板</button>
                    </div>
                </div>
            );
        }
        const q = session.current.q;
        return (
            <div className="app">

                <header>
                    <h1>第 {session.answeredCount + 1} 题</h1>
                    <button className="btn secondary"
                        style={{ width: "auto", padding: "8px 14px", fontSize: 14, margin: 0 }}
                        onClick={() => { session.endSession(); setView("home"); }}
                        disabled={session.saving || session.repairingDaily}>结束</button>
                </header>

                <div className="card">
                    <QuestionRenderer
                        question={q}
                        questionKey={session.current.key}
                        answered={session.answerLocked}
                        onAnswer={session.handleAnswer}
                    />
                </div>

                {session.pendingRating && (
                    <div className="card">
                        <div className="feedback ok">
                            ✅ 回答正确！
                        </div>

                        <p style={{
                            marginTop: 14,
                            marginBottom: 14,
                            fontSize: 14
                        }}>
                            这次回忆对你来说有多难？
                        </p>

                        <div style={{
                            display: "grid",
                            gridTemplateColumns:
                                "repeat(3, minmax(0, 1fr))",
                            gap: 10
                        }}>
                            <button
                                className="btn secondary"
                                disabled={session.saving}
                                onClick={() =>
                                    session.confirmRating(Rating.Hard)
                                }
                            >
                                Hard
                                <small style={{ display: "block" }}>
                                    有点吃力
                                </small>
                            </button>

                            <button
                                className="btn"
                                disabled={session.saving}
                                onClick={() =>
                                    session.confirmRating(Rating.Good)
                                }
                            >
                                Good
                                <small style={{ display: "block" }}>
                                    正常回忆
                                </small>
                            </button>

                            <button
                                className="btn secondary"
                                disabled={session.saving}
                                onClick={() =>
                                    session.confirmRating(Rating.Easy)
                                }
                            >
                                Easy
                                <small style={{ display: "block" }}>
                                    非常轻松
                                </small>
                            </button>
                        </div>

                        <p style={{
                            marginTop: 12,
                            fontSize: 12,
                            color: "#86868b"
                        }}>
                            选择评分后保存本次复习记录
                        </p>
                    </div>
                )}

                {session.saving && (
                    <div className="card">
                        <p role="status">
                            正在保存答题结果…
                        </p>
                    </div>
                )}

                {session.saveError && (
                    <div className="card">
                        <p
                            role="alert"
                            style={{ color: "#d93025" }}
                        >
                            {session.saveError}
                        </p>
                    </div>
                )}
                {session.answered && (
                    <div className="card">
                        {session.current.lastCorrect === false ? (
                            <>
                                <div className="feedback bad">❌ 答错了</div>
                                <p style={{ fontSize: 14, color: "#86868b", whiteSpace: "pre-wrap", marginTop: 12 }}>{q.explanation}</p>
                                <button className="btn" style={{ marginTop: 14 }} onClick={session.nextQuestion} disabled={
                                    session.saving ||
                                    session.repairingDaily ||
                                    !!session.dailyRepair
                                }>下一题 →</button>
                            </>
                        ) : (
                            <div className="feedback ok">
                                {session.dailyRepair
                                    ? "✅ 答案已保存，请先修复今日统计"
                                    : "✅ 正确，即将进入下一题…"}
                            </div>
                        )}
                    </div>
                )}
                {dailyRepairPanel}
            </div>
        );
    }

    if (displayView === "summary") {
        return (
            <div className="app">
                <div className="card" style={{ textAlign: "center" }}>
                    <h1 style={{ fontSize: 20, marginBottom: 12 }}>复习完成</h1>
                    <div style={{ fontSize: 48, fontWeight: 700, color: "#007aff" }}>
                        {session.correctCount} / {session.answeredCount}
                    </div>
                    <p style={{ color: "#86868b", marginTop: 8 }}>
                        正确率 {session.answeredCount > 0 ? Math.round(session.correctCount / session.answeredCount * 100) : 0}%
                    </p>
                    <button className="btn" style={{ marginTop: 20 }} onClick={() => setView("home")}>返回面板</button>
                </div>
            </div>
        );
    }

    return null;
}
import { useEffect, useState } from "react";

import { db, type ReviewDB, type AnswerLog } from "../db/db";

import type { KnowledgeBase } from "../data/schema";

import type { ReviewUnit } from "../review/units";
import { calculateProgress } from "../review/progress";
import { getKnowledgeKey } from "../review/progression";

type Mode = "due" | "vocab" | "grammar" | "topic" | "mix";

interface Props {
    kb: KnowledgeBase;
    units: Record<string, ReviewUnit>;
    dueReviewCount: number;
    newUnitCount: number;
    progressionCount?: number;
    database?: ReviewDB;
    refreshRevision?: number;
    onStart: (m: Mode) => void;
    onWrongBook: () => void;
    onPractice: () => void;
    onReset: () => void;
    onExportBackup?: () => Promise<void>;
}

export default function Dashboard({
    kb,
    units,
    dueReviewCount,
    newUnitCount,
    progressionCount = 0,
    onStart, onWrongBook, onPractice, onReset,
    onExportBackup,
    database = db, refreshRevision = 0
}: Props) {
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState("");

    async function handleExportBackup() {
        if (!onExportBackup || exporting) return;

        setExporting(true);
        setExportError("");

        try {
            await onExportBackup();
        } catch (error) {
            console.error("导出学习数据失败：", error);

            setExportError(
                error instanceof Error
                    ? error.message
                    : "导出失败，请稍后重试。"
            );
        } finally {
            setExporting(false);
        }
    }

    const [logState, setLogState] = useState<{
        database: ReviewDB;
        logs: AnswerLog[];
    } | null>(null);

    const logs =
        logState?.database === database
            ? logState.logs
            : [];
    const [daysToShow, setDaysToShow] = useState(7);

    useEffect(() => {
        const handleResize = () => {
            setDaysToShow(window.innerWidth < 600 ? 4 : 7);
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);


    useEffect(() => {
        let active = true;

        async function loadLogs() {
            try {
                const result =
                    await database.logs.toArray();

                if (active) {
                    setLogState({
                        database,
                        logs: result
                    });
                }
            } catch (error) {
                if (active) {
                    console.error(
                        "Dashboard 读取答题日志失败：",
                        error
                    );
                }
            }
        }

        void loadLogs();

        return () => {
            active = false;
        };
    }, [database, refreshRevision, units]);

    const totalLogs = logs.length;
    const correctLogs = logs.filter(l => l.correct).length;
    const accuracy = totalLogs > 0 ? Math.round((correctLogs / totalLogs) * 100) : 0;


    const lastLogByUnit = new Map<string, AnswerLog>();

    for (const log of logs) {
        const previous = lastLogByUnit.get(log.unitKey);

        if (
            !previous ||
            log.at > previous.at ||
            (
                log.at === previous.at &&
                (log.id ?? 0) > (previous.id ?? 0)
            )
        ) {
            lastLogByUnit.set(log.unitKey, log);
        }
    }


    const wrongKnowledgeKeys = new Set<string>();

    for (const [unitKey, log] of lastLogByUnit.entries()) {
        const unit = units[unitKey];

        if (!unit || log.correct) {
            continue;
        }

        wrongKnowledgeKeys.add(
            getKnowledgeKey(unit)
        );
    }

    const wrongCount = wrongKnowledgeKeys.size;

    const recentDays = Array.from({ length: daysToShow }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (daysToShow - 1 - i));
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
        const dayLogs = logs.filter(l => {
            const logDate = new Date(l.at);
            return logDate.getFullYear() === d.getFullYear() &&
                logDate.getMonth() === d.getMonth() &&
                logDate.getDate() === d.getDate();
        });
        return { label: dateStr, count: dayLogs.length };
    });
    const maxDayCount = Math.max(1, ...recentDays.map(d => d.count));

    const totalVocab = kb.lessons.reduce((sum, l) => sum + l.vocabGroups.reduce((n, g) => n + g.items.length, 0), 0);
    const totalGrammar = kb.lessons.reduce((sum, l) => sum + l.grammars.length, 0);
    const totalTopic = kb.lessons.reduce((sum, l) => sum + l.topics.length, 0);

    const courseStats = calculateProgress(kb, units);

    const totalKnowledge = courseStats.reduce(
        (sum, lesson) => sum + lesson.total,
        0
    );

    const masteredKnowledge = courseStats.reduce(
        (sum, lesson) => sum + lesson.mastered,
        0
    );

    const unavailableKnowledge = courseStats.reduce(
        (sum, lesson) => sum + lesson.unavailable,
        0
    );

    const generateSmoothPath = (points: { x: number; y: number }[]) => {
        if (points.length === 0) return "";
        if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

        let d = `M ${points[0].x},${points[0].y}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i - 1] || points[i];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2] || p2;

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
        }
        return d;
    };

    const chartPoints = recentDays.map((d, i) => {
        const x = daysToShow > 1 ? (i / (daysToShow - 1)) * 100 : 50;
        const y = 100 - (d.count / maxDayCount) * 70 - 15;
        return { x, y, count: d.count, label: d.label };
    });

    return (
        <div className="app">
            <header>
                <div>
                    <h1>Yes Han!</h1>
                    <p className="subtitle">
                        已收录 {kb.lessons.length} 课，
                        共 {totalKnowledge} 个知识点，
                        已掌握 {masteredKnowledge} 个
                        {unavailableKnowledge > 0 && (
                            <>
                                ，待补充 {unavailableKnowledge} 个
                            </>
                        )}
                    </p>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {onExportBackup && (
                        <button
                            className="btn secondary"
                            style={{
                                width: "auto",
                                padding: "8px 16px",
                                margin: 0
                            }}
                            disabled={exporting}
                            onClick={() => void handleExportBackup()}
                        >
                            {exporting
                                ? "正在导出…"
                                : "💾 导出学习数据"}
                        </button>
                    )}

                    {!showResetConfirm ? (
                        <button
                            className="btn danger"
                            style={{ width: "auto", padding: "8px 16px", margin: 0 }}
                            onClick={() => setShowResetConfirm(true)}
                        >
                            重置进度
                        </button>
                    ) : (
                        <>
                            <span style={{ fontSize: 14, color: "#ff3b30", fontWeight: 600 }}>确定要清空吗？</span>
                            <button
                                className="btn secondary"
                                style={{ width: "auto", padding: "8px 16px", margin: 0 }}
                                onClick={() => setShowResetConfirm(false)}
                            >
                                取消
                            </button>
                            <button
                                className="btn danger"
                                style={{ width: "auto", padding: "8px 16px", margin: 0 }}
                                onClick={() => {
                                    setShowResetConfirm(false);
                                    onReset();
                                }}
                            >
                                确认重置
                            </button>
                        </>
                    )}
                </div>
            </header>

            {exportError && (
                <p
                    role="alert"
                    style={{
                        color: "#c0392b",
                        padding: "8px 12px"
                    }}
                >
                    备份导出失败：{exportError}
                </p>
            )}

            <div className="dashboard-grid">

                {/* ================= 左侧栏 ================= */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "100%" }}>

                    {/* 1. 开始学习 */}
                    <div className="card">
                        <div className="card-title">开始学习</div>
                        <button
                            className="btn"
                            onClick={() => onStart("due")}
                            disabled={
                                dueReviewCount +
                                progressionCount +
                                newUnitCount === 0
                            }
                        >
                            {dueReviewCount +
                                progressionCount +
                                newUnitCount === 0
                                ? "今日任务已完成 🎉"
                                : `今日复习`
                            }
                        </button>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                            <button className="btn secondary" style={{ margin: 0 }} onClick={() => onStart("vocab")}>只练词汇</button>
                            <button className="btn secondary" style={{ margin: 0 }} onClick={() => onStart("grammar")}>只练语法</button>
                            <button className="btn secondary" style={{ margin: 0 }} onClick={() => onStart("topic")}>对话排序</button>
                            <button className="btn secondary" style={{ margin: 0 }} onClick={() => onStart("mix")}>混合练习</button>
                        </div>
                        <button
                            className="btn secondary"
                            style={{ marginTop: 12, marginBottom: 0 }}
                            onClick={onPractice}
                        >
                            定点练习
                        </button>
                    </div>

                    {/* 2. 学习数据与近七天（左右并排） */}
                    <div className="card" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                        <div className="card-title">学习数据</div>

                        {/* 内部左右布局：窄屏时自动换行变上下 */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "stretch", flex: 1 }}>

                            {/* 左侧：竖向排列的数据指标 */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: "1 1 180px", justifyContent: "center" }}>
                                <div className="stat-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", border: "1px solid #f0f0f0" }}>
                                    <span className="stat-label" style={{ fontSize: 14 }}>总答题数</span>
                                    <span className="stat-num" style={{ fontSize: 24 }}>{totalLogs}</span>
                                </div>
                                <div className="stat-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", border: "1px solid #f0f0f0" }}>
                                    <span className="stat-label" style={{ fontSize: 14 }}>总正确率</span>
                                    <span className="stat-num" style={{ fontSize: 24 }}>{accuracy}%</span>
                                </div>
                            </div>

                            {/* 右侧：平滑折线图 */}
                            <div style={{ flex: "2 1 250px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                                {/* <div className="text-muted" style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>近期答题量</div> */}

                                <div style={{ position: "relative", width: "100%", height: 140 }}>
                                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                                        {/* 渐变背景填充 */}
                                        <defs>
                                            <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#007aff" stopOpacity="0.2" />
                                                <stop offset="100%" stopColor="#007aff" stopOpacity="0" />
                                            </linearGradient>
                                        </defs>

                                        {/* 填充区域 */}
                                        <path
                                            d={`${generateSmoothPath(chartPoints)} L 100,100 L 0,100 Z`}
                                            fill="url(#lineGradient)"
                                        />

                                        {/* 平滑曲线 */}
                                        <path
                                            d={generateSmoothPath(chartPoints)}
                                            fill="none"
                                            stroke="#007aff"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    </svg>

                                    {/* X 轴标签和数据点 */}
                                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "flex" }}>
                                        {chartPoints.map((p, i) => (
                                            <div key={i} style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
                                                {/* 数据点 (仅在大于0时显示) */}
                                                {p.count > 0 && (
                                                    <div style={{
                                                        position: "absolute",
                                                        left: `${p.x}%`,
                                                        top: `${p.y}%`,
                                                        transform: "translate(-50%, -50%)",
                                                        width: 8,
                                                        height: 8,
                                                        background: "#fff",
                                                        border: "2.5px solid #007aff",
                                                        borderRadius: "50%",
                                                        zIndex: 2
                                                    }} />
                                                )}
                                                {/* 底部文字标签 */}
                                                <span style={{ fontSize: 11, color: "#86868b", marginTop: "auto", transform: "translateY(20px)" }}>{p.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>

                {/* ================= 右侧栏 ================= */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                    {/* 4. 错题本快捷卡片 */}
                    <div className="card">
                        <div className="card-title">
                            错题本
                            <span style={{ fontSize: 13, color: "#ff3b30", cursor: "pointer" }} onClick={onWrongBook}>
                                查看全部 →
                            </span>
                        </div>
                        {wrongCount === 0 ? (
                            <p className="text-muted">暂无错题，继续保持！</p>
                        ) : (
                            <div>
                                <p className="text-muted" style={{ marginBottom: 12 }}>共有 {wrongCount} 个知识点需要加强</p>
                                <button className="btn secondary" onClick={onWrongBook}>去重做错题</button>
                            </div>
                        )}
                    </div>

                    {/* 5. 课程内容与进度 */}
                    <div className="card">
                        <div className="card-title">课程内容</div>

                        {/* 全局总数汇总 */}
                        <div className="stat-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginBottom: 24 }}>
                            <div className="stat-box" style={{ padding: "12px 8px" }}>
                                <div className="stat-num" style={{ fontSize: 20 }}>{totalVocab}</div>
                                <div className="stat-label">词汇</div>
                            </div>
                            <div className="stat-box" style={{ padding: "12px 8px" }}>
                                <div className="stat-num" style={{ fontSize: 20 }}>{totalGrammar}</div>
                                <div className="stat-label">语法</div>
                            </div>
                            <div className="stat-box" style={{ padding: "12px 8px" }}>
                                <div className="stat-num" style={{ fontSize: 20 }}>{totalTopic}</div>
                                <div className="stat-label">对话</div>
                            </div>
                        </div>

                        {/* 每一课的具体信息 */}
                        <div style={{ maxHeight: "200px", overflowY: "auto", paddingRight: 4 }}>

                            {courseStats.map(c => (
                                <div
                                    key={c.lessonId}
                                    style={{ marginBottom: 18 }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            fontSize: 14,
                                            marginBottom: 6
                                        }}
                                    >
                                        <span style={{ fontWeight: 600 }}>
                                            {c.title}
                                        </span>

                                        <span className="text-muted">
                                            {c.mastered}/{c.total} · {c.percent}%
                                        </span>
                                    </div>

                                    <div
                                        className="text-muted"
                                        style={{
                                            fontSize: 12,
                                            marginBottom: 8,
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 10
                                        }}
                                    >
                                        <span>
                                            词汇 {c.vocab.mastered}/{c.vocab.total}
                                        </span>

                                        <span>
                                            语法 {c.grammar.mastered}/{c.grammar.total}
                                        </span>

                                        <span>
                                            对话 {c.topic.mastered}/{c.topic.total}
                                        </span>
                                    </div>

                                    <div
                                        style={{
                                            height: 7,
                                            background: "#e5e5ea",
                                            borderRadius: 4,
                                            overflow: "hidden"
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: `${c.percent}%`,
                                                height: "100%",
                                                background:
                                                    c.percent === 100
                                                        ? "#34c759"
                                                        : "#007aff",
                                                transition: "width 0.3s"
                                            }}
                                        />
                                    </div>

                                    {c.unavailable > 0 && (
                                        <p
                                            className="text-muted"
                                            style={{
                                                fontSize: 12,
                                                marginTop: 6
                                            }}
                                        >
                                            ⚠️ {c.unavailable} 个知识点暂不可练习，
                                            需要检查例句或复习单元
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
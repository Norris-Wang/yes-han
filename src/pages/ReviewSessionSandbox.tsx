
import {
    useEffect,
    useMemo,
    useState
} from "react";

import type { KnowledgeBase } from "../data/schema";
import { loadKnowledgeBase } from "../data/loader";
import type { ReviewUnit } from "../review/units";
import { buildUnitsForLesson } from "../review/units";
import { generateFor } from "../generators";
import { useReviewSession } from "../hooks/useReviewSession";
import { Rating, type Grade } from "ts-fsrs";

type Scenario = "rating" | "progression" | "duplicate";

type Config = {
    kb: KnowledgeBase;
    units: Record<string, ReviewUnit>;
    learnedItems: string[];
};

const DAY = 86400000;

function createConfig(
    kb: KnowledgeBase,
    scenario: Scenario
): Config {
    const candidates = kb.lessons
        .flatMap(buildUnitsForLesson)
        .filter(u =>
            u.itemType === "vocab" &&
            u.direction === "kr2zh" &&
            generateFor(kb, u) !== null
        );

    const a = candidates[0];
    const b = candidates.find(
        u => u.itemId !== a?.itemId ||
            u.lessonId !== a?.lessonId
    );

    if (!a || !b) {
        throw new Error("课程中缺少测试词汇");
    }

    const now = Date.now();

    if (scenario === "rating") {
        const fsrs: ReviewUnit = {
            ...a,
            schedulingAlgorithm: "fsrs",
            seen: 2,
            stage: 0,
            dueAt: now - DAY
        };

        const fixed: ReviewUnit = {
            ...b,
            schedulingAlgorithm: "fixed",
            seen: 3,
            stage: 2,
            dueAt: now - DAY / 2
        };

        return {
            kb,
            units: {
                [fsrs.key]: fsrs,
                [fixed.key]: fixed
            },
            learnedItems: []
        };
    }

    if (scenario === "progression") {
        const known: ReviewUnit = {
            ...a,
            seen: 3,
            stage: 4,
            streak: 3,
            dueAt: now + DAY
        };

        const next: ReviewUnit = {
            ...a,
            key:
                `${a.lessonId}|vocab|${a.itemId}|zh2kr`,
            direction: "zh2kr",
            seen: 0,
            stage: 0
        };

        return {
            kb,
            units: {
                [known.key]: known,
                [next.key]: next
            },
            learnedItems: []
        };
    }

    // 模拟两门课程拥有相同的词汇 itemId
    const originalLesson = kb.lessons.find(
        l => l.id === a.lessonId
    )!;

    const copiedLesson = {
        ...originalLesson,
        id: `${originalLesson.id}_sandbox_copy`
    };

    const copiedUnit: ReviewUnit = {
        ...a,
        lessonId: copiedLesson.id,
        key:
            `${copiedLesson.id}|vocab|${a.itemId}|kr2zh`
    };

    return {
        kb: {
            ...kb,
            lessons: [...kb.lessons, copiedLesson]
        },
        units: {
            [a.key]: { ...a },
            [copiedUnit.key]: copiedUnit
        },
        // 已学19个词汇：今日仅剩1个新词汇名额
        learnedItems: Array.from(
            { length: 19 },
            (_, i) => `vocab_mock_${i}`
        )
    };
}

function TestSession({
    config,
    scenario
}: {
    config: Config;
    scenario: Scenario;
}) {
    const [units, setUnits] = useState(config.units);

    const [started, setStarted] = useState(false);
    const [saved] = useState<
        { key: string; correct: boolean; rating?: Grade }[]
    >([]);

    const [persisted] = useState(
        config.learnedItems
    );

    // 只在内存中模拟保存；绝不写入 IndexedDB



    const session = useReviewSession(
        config.kb,
        units,
        setUnits
    );

    function start() {
        const ok = session.startSession(
            "due",
            Object.values(units),
            () => true
        );

        setStarted(ok);
    }

    const buttonStyle = {
        padding: "10px 14px",
        margin: 4
    };

    return (
        <div style={{ padding: 20 }}>
            <h2>每日复习 Hook 隔离测试</h2>

            <p>当前场景：{scenario}</p>
            <p>测试数据库写入：无（内存模拟）</p>

            {!started && (
                <button
                    style={buttonStyle}
                    onClick={start}
                >
                    开始模拟每日复习
                </button>
            )}

            {started && (
                <>
                    <p>
                        已选题数：{session.queue.length}
                    </p>

                    <p>
                        当前单元：
                        {session.current?.key ?? "无"}
                    </p>

                    <p>
                        等待评分：
                        {session.pendingRating ?? "否"}
                    </p>

                    <p>
                        保存中的状态：
                        {String(session.saving)}
                    </p>

                    <p>
                        模拟保存成功次数：
                        {saved.length}
                    </p>

                    <p>
                        今日学习知识点数：
                        {session.learnedItems.length}
                    </p>

                    <p>
                        模拟持久化统计数：
                        {persisted.length}
                    </p>

                    <div>
                        <button
                            style={buttonStyle}
                            disabled={!session.current ||
                                session.answerLocked}
                            onClick={() =>
                                session.handleAnswer(true)
                            }
                        >
                            模拟答对
                        </button>

                        <button
                            style={buttonStyle}
                            onClick={session.nextQuestion}
                        >
                            尝试下一题
                        </button>
                    </div>

                    {session.pendingRating && (
                        <div>
                            <button
                                style={buttonStyle}
                                onClick={() =>
                                    session.confirmRating(
                                        Rating.Hard
                                    )
                                }
                            >
                                Hard
                            </button>

                            <button
                                style={buttonStyle}
                                onClick={() =>
                                    session.confirmRating(
                                        Rating.Good
                                    )
                                }
                            >
                                Good
                            </button>

                            <button
                                style={buttonStyle}
                                onClick={() =>
                                    session.confirmRating(
                                        Rating.Easy
                                    )
                                }
                            >
                                Easy
                            </button>
                        </div>
                    )}

                    <h3>选中的单元</h3>
                    <pre style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere"
                    }}>
                        {session.queue.join("\n")}
                    </pre>

                    <h3>模拟保存记录</h3>
                    <pre>
                        {JSON.stringify(saved, null, 2)}
                    </pre>
                </>
            )}
        </div>
    );
}

export default function ReviewSessionSandbox() {
    const [kb, setKb] =
        useState<KnowledgeBase | null>(null);

    const [error, setError] = useState("");
    const [scenario, setScenario] =
        useState<Scenario>("rating");

    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let active = true;

        loadKnowledgeBase()
            .then(data => {
                if (active) setKb(data);
            })
            .catch(e => {
                if (active) setError(String(e));
            });

        return () => {
            active = false;
        };
    }, []);

    const config = useMemo(() => {
        if (!kb) return null;
        return createConfig(kb, scenario);
    }, [kb, scenario]);

    if (error) {
        return <p role="alert">{error}</p>;
    }

    if (!config) {
        return <p>正在加载测试课程…</p>;
    }

    return (
        <div>
            <div style={{ padding: 16 }}>
                <h1>🧪 FSRS 每日复习隔离环境</h1>

                <button onClick={() =>
                    setScenario("rating")
                }>
                    测试1：等待评分
                </button>

                <button onClick={() =>
                    setScenario("progression")
                }>
                    测试2：题型进阶
                </button>

                <button onClick={() =>
                    setScenario("duplicate")
                }>
                    测试3：重复 ID
                </button>

                <button onClick={() =>
                    setRevision(n => n + 1)
                }>
                    重置当前测试
                </button>
            </div>

            <TestSession
                key={`${scenario}-${revision}`}
                scenario={scenario}
                config={config}
            />
        </div>
    );
}

import {
    useCallback,
    useEffect,
    useRef,
    useState
} from "react";

import { Rating } from "ts-fsrs";

import { ReviewDB } from "../db/db";
import { saveAnswerToDb } from "../db/answerService";
import { loadKnowledgeBase, syncUnitsToDB } from "../data/loader";
import { generateFor } from "../generators";

import type { KnowledgeBase } from "../data/schema";
import type { ReviewUnit } from "../review/units";

import Dashboard from "./Dashboard";
import WrongBook from "./WrongBook";

type Page = "dashboard" | "wrongbook";

type Metrics = {
    logs: number;
    correct: number;
    seen: number;
    lapses: number;
    wrong: boolean;
};

const DAY = 86400000;

export default function FsrsIntegrationSandbox() {
    const [database] = useState(() =>
        new ReviewDB(
            "korean-ui-integration-" +
            Date.now() + "-" +
            Math.random().toString(36).slice(2)
        )
    );

    const setupRef = useRef<Promise<KnowledgeBase> | null>(null);
    const targetKeyRef = useRef("");
    const [targetKey, setTargetKey] = useState("");

    const [kb, setKb] = useState<KnowledgeBase | null>(null);
    const [units, setUnits] = useState<Record<string, ReviewUnit>>({});
    const [page, setPage] = useState<Page>("dashboard");
    const [revision, setRevision] = useState(0);
    const [metrics, setMetrics] = useState<Metrics | null>(null);
    const [busy, setBusy] = useState(false);
    const [closed, setClosed] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const writingRef = useRef(false);

    const refresh = useCallback(async () => {
        const [rows, logs] = await Promise.all([
            database.units.toArray(),
            database.logs.toArray()
        ]);

        setUnits(Object.fromEntries(
            rows.map(u => [u.key, u])
        ));

        const key = targetKeyRef.current;
        const target = rows.find(u => u.key === key);

        const history = logs
            .filter(log => log.unitKey === key)
            .sort((a, b) =>
                a.at - b.at ||
                (a.id ?? 0) - (b.id ?? 0)
            );

        const last = history[history.length - 1];

        setMetrics({
            logs: history.length,
            correct: history.filter(l => l.correct).length,
            seen: target?.seen ?? 0,
            lapses: target?.lapses ?? 0,
            wrong: last ? !last.correct : false
        });

        setRevision(n => n + 1);
    }, [database]);

    useEffect(() => {
        let active = true;

        // 防止 React StrictMode 重复执行数据初始化
        if (!setupRef.current) {
            setupRef.current = (async () => {
                const knowledge = await loadKnowledgeBase();

                await database.open();

                // 仅在临时数据库中创建 FSRS 单元
                const unitMap = await syncUnitsToDB(
                    knowledge,
                    database,
                    "fsrs"
                );

                const target = Object.values(unitMap).find(
                    unit =>
                        unit.itemType === "vocab" &&
                        unit.direction === "kr2zh" &&
                        generateFor(knowledge, unit) !== null
                );

                if (!target) {
                    throw new Error("找不到可测试的词汇题");
                }

                const question = generateFor(
                    knowledge,
                    target
                );

                if (!question) {
                    throw new Error("生成测试题失败");
                }

                targetKeyRef.current = target.key;
                setTargetKey(target.key);

                // 第一次学习：Good
                // 时间设置在过去，便于构造再次到期
                const firstAt = Date.now() - 365 * DAY;

                const first = await saveAnswerToDb(
                    database,
                    target.key,
                    true,
                    question.type,
                    firstAt,
                    Rating.Good
                );

                // 第二次复习：Again
                const wrongAt = Date.now() - 1000;

                if (first.dueAt > wrongAt) {
                    throw new Error(
                        "测试卡片尚未到期，无法构造本次场景"
                    );
                }

                await saveAnswerToDb(
                    database,
                    target.key,
                    false,
                    question.type,
                    wrongAt,
                    Rating.Again
                );

                return knowledge;
            })();
        }

        void setupRef.current
            .then(async knowledge => {
                if (!active) return;

                setKb(knowledge);
                await refresh();
            })
            .catch(e => {
                if (active) {
                    setError(String(e));
                }
            });

        return () => {
            active = false;
        };
    }, [database, refresh]);

    // 真实保存服务 + 隔离数据库
    const saveInSandbox = useCallback(
        async (
            ...args: Parameters<typeof saveAnswerToDb>
        ): Promise<ReviewUnit> => {
            if (args[0] !== database) {
                throw new Error(
                    "安全检查失败：保存目标不是测试数据库"
                );
            }

            writingRef.current = true;
            setBusy(true);

            try {
                const saved =
                    await saveAnswerToDb(...args);

                // 数据已保存成功，刷新失败不能再被当作写入失败
                try {
                    await refresh();
                } catch (e) {
                    console.error("刷新测试统计失败", e);
                    setMessage("答案已保存，但统计刷新失败");
                }

                return saved;
            } finally {
                writingRef.current = false;
                setBusy(false);
            }
        },
        [database, refresh]
    );

    async function goDashboard() {
        if (writingRef.current) return;

        try {
            await refresh();
            setPage("dashboard");
        } catch (e) {
            setError(String(e));
        }
    }

    async function cleanup() {
        if (writingRef.current || busy) return;

        try {
            await database.delete();

            if (await ReviewDB.exists(database.name)) {
                throw new Error("临时数据库仍存在");
            }

            setClosed(true);
        } catch (e) {
            setError("清理失败：" + String(e));
        }
    }

    if (closed) {
        return (
            <div style={{ padding: 30 }}>
                ✅ 临时测试数据库已删除。
                正式学习数据未被本测试代码写入。
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ padding: 30 }}>
                <p role="alert">{error}</p>
                <button onClick={() => void cleanup()}>
                    清理临时数据库
                </button>
            </div>
        );
    }

    if (!kb || !metrics) {
        return (
            <div style={{ padding: 30 }}>
                正在准备独立 FSRS UI 测试数据…
            </div>
        );
    }

    return (
        <div>
            <div
                style={{
                    padding: 16,
                    background: "#fff3cd",
                    color: "#594400"
                }}
            >
                <strong>🧪 FSRS 真实 UI 隔离验收</strong>

                <p>
                    当前数据库：{database.name}
                </p>

                <p>
                    测试单元：
                    {targetKey}
                </p>

                <p>
                    答题日志：{metrics.logs} 条
                    正确：{metrics.correct} 条
                    seen：{metrics.seen}
                    lapses：{metrics.lapses}
                </p>

                <p>
                    当前错题状态：
                    {metrics.wrong ? "待解决" : "已解决"}
                </p>

                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8
                    }}
                >
                    <button
                        disabled={busy}
                        onClick={() => void goDashboard()}
                    >
                        查看 Dashboard
                    </button>

                    <button
                        disabled={busy}
                        onClick={() => setPage("wrongbook")}
                    >
                        打开 WrongBook
                    </button>

                    <button
                        disabled={busy}
                        onClick={() => void cleanup()}
                    >
                        清理并结束测试
                    </button>
                </div>

                {message && (
                    <p role="status">{message}</p>
                )}
            </div>

            {page === "dashboard" ? (
                <Dashboard
                    kb={kb}
                    units={units}
                    database={database}
                    refreshRevision={revision}
                    dueReviewCount={0}
                    newUnitCount={0}
                    onStart={() =>
                        setMessage("测试页不启动正式每日复习")
                    }
                    onWrongBook={() =>
                        setPage("wrongbook")
                    }
                    onPractice={() =>
                        setMessage("测试页不启动定点练习")
                    }
                    onReset={() =>
                        setMessage("隔离测试禁止重置进度")
                    }
                />
            ) : (
                <WrongBook
                    kb={kb}
                    database={database}
                    saveAnswerFn={saveInSandbox}
                    onBack={() => void goDashboard()}
                />
            )}
        </div>
    );
}
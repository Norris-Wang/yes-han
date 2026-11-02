
/**
 * YesHan 学习数据写入门禁。
 *
 * 所有同一个 ReviewDB 的写入使用相同独占锁。
 * 锁不可用、冲突或申请失败时，拒绝执行操作。
 *
 * 注意：这属于协作锁。
 * 只有主动接入此模块的写入入口才受到保护。
 */

const LOCK_PREFIX = "yeshan:learning-write:v1:";

export class LearningWriteBlockedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "LearningWriteBlockedError";
    }
}

export function learningWriteLockName(
    databaseName: string
): string {
    if (
        typeof databaseName !== "string" ||
        databaseName.trim() === ""
    ) {
        throw new LearningWriteBlockedError(
            "数据库名称无效，拒绝写入"
        );
    }

    return LOCK_PREFIX + databaseName;
}

export async function withLearningWriteLock<T>(
    databaseName: string,
    operation: () => Promise<T>
): Promise<T> {
    const manager = navigator.locks;

    if (
        !manager ||
        typeof manager.request !== "function"
    ) {
        throw new LearningWriteBlockedError(
            "浏览器不支持学习数据写入锁，已拒绝写入"
        );
    }

    const name = learningWriteLockName(databaseName);

    try {
        return await manager.request(
            name,
            {
                mode: "exclusive",
                ifAvailable: true
            },
            async lock => {
                if (!lock) {
                    throw new LearningWriteBlockedError(
                        "其他标签页正在写入或执行维护操作"
                    );
                }

                // operation 全部完成后才释放锁。
                return await operation();
            }
        );
    } catch (error) {
        if (error instanceof LearningWriteBlockedError) {
            throw error;
        }

        // 不能把业务操作本身的失败误报为锁冲突。
        throw error;
    }
}
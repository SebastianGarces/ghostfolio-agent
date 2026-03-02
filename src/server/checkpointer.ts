import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  TASKS,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId,
  maxChannelVersion
} from '@langchain/langgraph-checkpoint';
import type {
  ChannelVersions,
  Checkpoint,
  CheckpointListOptions,
  CheckpointTuple
} from '@langchain/langgraph-checkpoint';
import type {
  CheckpointMetadata,
  PendingWrite
} from '@langchain/langgraph-checkpoint';
import { Database } from 'bun:sqlite';

const DB_PATH = process.env.AGENT_CHECKPOINT_DB ?? './data/checkpoints.db';

/**
 * SQLite-backed checkpoint saver using Bun's built-in `bun:sqlite`.
 *
 * Replaces the in-process `SessionMemoryManager` with persistent, thread-aware
 * checkpoint storage. Survives restarts and supports multiple threads.
 */
export class BunSqliteSaver extends BaseCheckpointSaver {
  private db: Database;

  constructor(dbPath?: string) {
    super();
    const resolvedPath = dbPath ?? DB_PATH;

    // Ensure parent directory exists
    const dir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'));
    if (dir) {
      try {
        const { mkdirSync } = require('node:fs');
        mkdirSync(dir, { recursive: true });
      } catch {
        // directory already exists
      }
    }

    this.db = new Database(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this._createTables();
  }

  private _createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        type TEXT NOT NULL,
        checkpoint BLOB NOT NULL,
        metadata BLOB NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        value BLOB NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      )
    `);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';
    let checkpointId = getCheckpointId(config);

    if (!threadId) return undefined;

    let row: {
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      type: string;
      checkpoint: Uint8Array;
      metadata: Uint8Array;
    } | null;

    if (checkpointId) {
      row = this.db
        .query(
          `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
           FROM checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
        )
        .get(threadId, checkpointNs, checkpointId) as typeof row;
    } else {
      row = this.db
        .query(
          `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
           FROM checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ?
           ORDER BY checkpoint_id DESC LIMIT 1`
        )
        .get(threadId, checkpointNs) as typeof row;
    }

    if (!row) return undefined;

    checkpointId = row.checkpoint_id;
    const parentCheckpointId = row.parent_checkpoint_id ?? undefined;

    const deserializedCheckpoint = (await this.serde.loadsTyped(
      row.type,
      row.checkpoint
    )) as Checkpoint;
    const deserializedMetadata = (await this.serde.loadsTyped(
      row.type,
      row.metadata
    )) as CheckpointMetadata;

    // Migrate pending sends for v<4 checkpoints
    if (deserializedCheckpoint.v < 4 && parentCheckpointId !== undefined) {
      await this._migratePendingSends(
        deserializedCheckpoint,
        threadId,
        checkpointNs,
        parentCheckpointId
      );
    }

    // Load pending writes
    const writeRows = this.db
      .query(
        `SELECT task_id, channel, type, value
         FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
      )
      .all(threadId, checkpointNs, checkpointId) as {
      task_id: string;
      channel: string;
      type: string;
      value: Uint8Array;
    }[];

    const pendingWrites = await Promise.all(
      writeRows.map(async (w) => {
        const val = await this.serde.loadsTyped(w.type, w.value);
        return [w.task_id, w.channel, val] as [string, string, unknown];
      })
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId
        }
      },
      checkpoint: deserializedCheckpoint,
      metadata: deserializedMetadata,
      pendingWrites
    };

    if (parentCheckpointId !== undefined) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: parentCheckpointId
        }
      };
    }

    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const { before, limit, filter } = options ?? {};
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns;

    let query = `SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
                        type, checkpoint, metadata
                 FROM checkpoints WHERE 1=1`;
    const params: (string | number)[] = [];

    if (threadId) {
      query += ' AND thread_id = ?';
      params.push(threadId);
    }

    if (checkpointNs !== undefined) {
      query += ' AND checkpoint_ns = ?';
      params.push(checkpointNs);
    }

    if (before?.configurable?.checkpoint_id) {
      query += ' AND checkpoint_id < ?';
      params.push(before.configurable.checkpoint_id as string);
    }

    query += ' ORDER BY checkpoint_id DESC';

    if (limit !== undefined) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const rows = this.db.query(query).all(...params) as {
      thread_id: string;
      checkpoint_ns: string;
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      type: string;
      checkpoint: Uint8Array;
      metadata: Uint8Array;
    }[];

    for (const row of rows) {
      const metadata = (await this.serde.loadsTyped(
        row.type,
        row.metadata
      )) as CheckpointMetadata;

      // Apply metadata filter
      if (
        filter &&
        !Object.entries(filter).every(
          ([key, value]) =>
            (metadata as unknown as Record<string, unknown>)[key] === value
        )
      ) {
        continue;
      }

      const checkpoint = (await this.serde.loadsTyped(
        row.type,
        row.checkpoint
      )) as Checkpoint;

      if (checkpoint.v < 4 && row.parent_checkpoint_id) {
        await this._migratePendingSends(
          checkpoint,
          row.thread_id,
          row.checkpoint_ns,
          row.parent_checkpoint_id
        );
      }

      // Load pending writes for this checkpoint
      const writeRows = this.db
        .query(
          `SELECT task_id, channel, type, value
           FROM writes
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
        )
        .all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as {
        task_id: string;
        channel: string;
        type: string;
        value: Uint8Array;
      }[];

      const pendingWrites = await Promise.all(
        writeRows.map(async (w) => {
          const val = await this.serde.loadsTyped(w.type, w.value);
          return [w.task_id, w.channel, val] as [string, string, unknown];
        })
      );

      const tuple: CheckpointTuple = {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id
          }
        },
        checkpoint,
        metadata,
        pendingWrites
      };

      if (row.parent_checkpoint_id) {
        tuple.parentConfig = {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.parent_checkpoint_id
          }
        };
      }

      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';

    if (!threadId) {
      throw new Error(
        'Failed to put checkpoint. Missing "thread_id" in configurable.'
      );
    }

    const parentCheckpointId = config.configurable?.checkpoint_id ?? null;

    const [[type, serializedCheckpoint], [, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata)
      ]);

    this.db
      .query(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        parentCheckpointId,
        type,
        serializedCheckpoint,
        serializedMetadata
      );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id
      }
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId) {
      throw new Error(
        'Failed to put writes. Missing "thread_id" in configurable.'
      );
    }
    if (!checkpointId) {
      throw new Error(
        'Failed to put writes. Missing "checkpoint_id" in configurable.'
      );
    }

    const stmt = this.db.query(
      `INSERT OR IGNORE INTO writes
       (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i];
      const [type, serializedValue] = await this.serde.dumpsTyped(value);
      const idx =
        WRITES_IDX_MAP[channel as string] !== undefined
          ? WRITES_IDX_MAP[channel as string]
          : i;

      stmt.run(
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        idx,
        channel as string,
        type,
        serializedValue
      );
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.query('DELETE FROM writes WHERE thread_id = ?').run(threadId);
    this.db.query('DELETE FROM checkpoints WHERE thread_id = ?').run(threadId);
  }

  /**
   * Migrate pending sends from parent checkpoint writes (for v<4 checkpoints).
   */
  private async _migratePendingSends(
    mutableCheckpoint: Checkpoint,
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string
  ): Promise<void> {
    const parentWrites = this.db
      .query(
        `SELECT type, value FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND channel = ?`
      )
      .all(threadId, checkpointNs, parentCheckpointId, TASKS) as {
      type: string;
      value: Uint8Array;
    }[];

    const pendingSends = await Promise.all(
      parentWrites.map(async (w) => this.serde.loadsTyped(w.type, w.value))
    );

    mutableCheckpoint.channel_values ??= {} as Record<string, unknown>;
    (mutableCheckpoint.channel_values as Record<string, unknown>)[TASKS] =
      pendingSends;

    mutableCheckpoint.channel_versions ??= {} as Record<string, number>;
    const versions = Object.values(mutableCheckpoint.channel_versions);
    (mutableCheckpoint.channel_versions as Record<string, number | string>)[
      TASKS
    ] =
      versions.length > 0
        ? maxChannelVersion(...(versions as (number | string)[]))
        : this.getNextVersion(undefined as unknown as number);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

/** Singleton checkpointer instance. */
export const checkpointer = new BunSqliteSaver();

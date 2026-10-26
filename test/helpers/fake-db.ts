import { PgDialect } from "drizzle-orm/pg-core";

/*
 * A recording stand-in for the Drizzle client. Every chained call returns another chain that resolves to the next
 * queued select result (or [] for writes), and each statement is logged so tests can assert what was written, to
 * which table, and that the `where` clause carried the workspace id.
 */

export type Op = {
  kind: "select" | "insert" | "update" | "delete";
  table?: unknown;
  values?: unknown;
  set?: unknown;
  calls: Array<{ name: string; args: unknown[] }>;
  /** The `where` clause rendered to SQL text and parameters, when the statement had one. */
  where?: { sql: string; params: unknown[] };
};

const dialect = new PgDialect();

function renderWhere(arg: unknown): Op["where"] {
  try {
    const { sql, params } = dialect.sqlToQuery(arg as never);
    return { sql, params };
  } catch {
    return undefined;
  }
}

/** `selectResults` feeds selects in order; `writeResults` feeds the `.returning()` of inserts, updates and deletes in order. */
export function fakeDb(selectResults: unknown[][] = [], writeResults: unknown[][] = []) {
  const ops: Op[] = [];
  const queue = [...selectResults];
  const writes = [...writeResults];

  const chain = (op: Op, result: () => unknown): unknown => new Proxy({}, {
    get: (_target, prop) => {
      if (prop === "then") {
        return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          try { return Promise.resolve(result()).then(resolve, reject); }
          catch (error) { return reject ? reject(error) : Promise.reject(error); }
        };
      }
      return (...args: unknown[]) => {
        op.calls.push({ name: String(prop), args });
        if (prop === "from") op.table = args[0];
        if (prop === "where") op.where = renderWhere(args[0]);
        if (prop === "values") op.values = args[0];
        if (prop === "set") op.set = args[0];
        return chain(op, result);
      };
    },
  });

  const start = (kind: Op["kind"], table: unknown, result: () => unknown) => {
    const op: Op = { kind, table, calls: [] };
    ops.push(op);
    return chain(op, result);
  };

  const db = {
    select: () => start("select", undefined, () => queue.shift() ?? []),
    insert: (table: unknown) => start("insert", table, () => writes.shift() ?? []),
    update: (table: unknown) => start("update", table, () => writes.shift() ?? []),
    delete: (table: unknown) => start("delete", table, () => writes.shift() ?? []),
  };
  return { db: db as never, ops };
}

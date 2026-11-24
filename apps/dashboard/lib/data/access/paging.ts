import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GSI1_NAME } from "@llm-usage-lens/shared";
import type { z } from "zod";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { decodeCursor, encodeCursor } from "./cursor";
import type { AccessResult, ListOptions, Page } from "./result";

// Source: docs/specs/2026-11-10-access-control.md — "Storage boundary (D26.4)";
// Rule 20.6 (paginate on LastEvaluatedKey). Callers receive an opaque signed
// cursor; a cursor minted for another partition is rejected.
const DEFAULT_LIMIT = 100;
const DIRECTION_ATTR = "_dir";

type PageQuery<S extends z.ZodType> = {
  schema: S;
  options: ListOptions;
  partition: string;
  sortPrefix?: string;
  index?: "GSI1";
  // Unit SRT1 (D-SR1): an optional order. The signed cursor carries it, so a
  // cursor from one direction is BAD_CURSOR under the other.
  direction?: "asc" | "desc";
};

export async function queryPage<S extends z.ZodType>(
  query: PageQuery<S>,
): Promise<AccessResult<Page<z.infer<S>>>> {
  const { schema, options, partition, sortPrefix, index, direction } = query;
  const pkAttr = index ? "gsi1pk" : "PK";
  const skAttr = index ? "gsi1sk" : "SK";

  let startKey: Record<string, string> | undefined;
  if (options.cursor !== undefined) {
    const decoded = decodeCursor(options.cursor, options.cursorSecret);
    if (
      !decoded.ok ||
      decoded.value[pkAttr] !== partition ||
      (sortPrefix !== undefined &&
        !decoded.value[skAttr]?.startsWith(sortPrefix))
    ) {
      return { ok: false, code: "BAD_CURSOR" };
    }
    const { [DIRECTION_ATTR]: cursorDirection, ...key } = decoded.value;
    if (direction !== undefined && (cursorDirection ?? "asc") !== direction) {
      return { ok: false, code: "BAD_CURSOR" };
    }
    startKey = direction !== undefined ? key : decoded.value;
  }

  const res = await getDocumentClient().send(
    new QueryCommand({
      TableName: getTableName(),
      ...(index ? { IndexName: GSI1_NAME } : {}),
      KeyConditionExpression: sortPrefix
        ? `${pkAttr} = :pk AND begins_with(${skAttr}, :sk)`
        : `${pkAttr} = :pk`,
      ExpressionAttributeValues: {
        ":pk": partition,
        ...(sortPrefix ? { ":sk": sortPrefix } : {}),
      },
      Limit: Math.min(
        DEFAULT_LIMIT,
        Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)),
      ),
      ...(direction === "desc" ? { ScanIndexForward: false } : {}),
      ExclusiveStartKey: startKey,
    }),
  );

  const items = (res.Items ?? []).map(
    (item) => schema.parse(item) as z.infer<S>,
  );
  const last = res.LastEvaluatedKey;
  if (!last) return { ok: true, value: { items } };
  const key: Record<string, string> = {};
  for (const [k, v] of Object.entries(last)) {
    if (typeof v !== "string") throw new Error(`non-string key attribute ${k}`);
    key[k] = v;
  }
  return {
    ok: true,
    value: {
      items,
      cursor: encodeCursor(
        direction !== undefined ? { ...key, [DIRECTION_ATTR]: direction } : key,
        options.cursorSecret,
      ),
    },
  };
}

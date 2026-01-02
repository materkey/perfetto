// Copyright (C) 2024 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {Engine} from '../../trace_processor/engine';
import {UNKNOWN} from '../../trace_processor/query_result';
import {DataSource} from '../../widgets/charts/d3/data/source';
import {Filter, Aggregation, Row} from '../../widgets/charts/d3/data/types';

/**
 * D3ChartSqlSource implements the DataSource interface using a custom SQL query.
 * It executes the provided SQL query and applies filters/aggregations on top of it.
 */
export class D3ChartSqlSource implements DataSource {
  constructor(
    private engine: Engine,
    private sqlQuery: string,
  ) {}

  async query(filters: Filter[], aggregation?: Aggregation): Promise<Row[]> {
    // Wrap the user's query in a CTE and apply filters/aggregations
    let sql = '';

    if (aggregation || filters.length > 0) {
      // Use the user's query as a CTE
      sql = `WITH user_query AS (${this.sqlQuery})\n`;

      if (aggregation) {
        // Build aggregation query
        const {fn, field, groupBy} = aggregation;

        // SELECT clause
        const selectParts: string[] = [];
        for (const col of groupBy) {
          selectParts.push(this.escapeIdentifier(col));
        }

        // Add aggregation function
        const aggExpr = this.buildAggregationExpr(fn, field);
        selectParts.push(`${aggExpr} AS ${this.escapeIdentifier(field)}`);

        sql += `SELECT ${selectParts.join(', ')} FROM user_query`;

        // WHERE clause
        if (filters.length > 0) {
          const whereClause = this.buildWhereClause(filters);
          sql += ` WHERE ${whereClause}`;
        }

        // GROUP BY clause
        if (groupBy.length > 0) {
          const groupByClause = groupBy
            .map((col) => this.escapeIdentifier(col))
            .join(', ');
          sql += ` GROUP BY ${groupByClause}`;
        }
      } else {
        // Just apply filters
        sql += `SELECT * FROM user_query`;
        if (filters.length > 0) {
          const whereClause = this.buildWhereClause(filters);
          sql += ` WHERE ${whereClause}`;
        }
      }
    } else {
      // No filters or aggregations, use the query as-is
      sql = this.sqlQuery;
    }

    const result = await this.engine.query(sql);

    // Convert QueryResult to Row[]
    const rows: Row[] = [];
    const columns = result.columns();

    // Build a spec for the iterator - use UNKNOWN for all columns
    // to handle any type (strings, numbers, bigints, nulls)
    const spec: Record<string, typeof UNKNOWN> = {};
    for (const col of columns) {
      spec[col] = UNKNOWN;
    }

    for (const it = result.iter(spec); it.valid(); it.next()) {
      const row: Row = {};
      for (const col of columns) {
        const value = it.get(col);
        // Try to convert string values to numbers if they look numeric
        if (typeof value === 'string') {
          const numValue = Number(value);
          row[col] = isNaN(numValue) ? value : numValue;
        } else if (typeof value === 'bigint') {
          row[col] = Number(value);
        } else {
          row[col] = value as string | number | boolean | null;
        }
      }
      rows.push(row);
    }

    return rows;
  }

  private buildWhereClause(filters: Filter[]): string {
    const conditions = filters.map((f) => this.buildFilterCondition(f));
    return conditions.join(' AND ');
  }

  private buildFilterCondition(filter: Filter): string {
    const col = this.escapeIdentifier(filter.col);
    const {op, val} = filter;

    switch (op) {
      case '=':
        return `${col} = ${this.escapeLiteral(val)}`;
      case '!=':
        return `${col} != ${this.escapeLiteral(val)}`;
      case '<':
        return `${col} < ${this.escapeLiteral(val)}`;
      case '<=':
        return `${col} <= ${this.escapeLiteral(val)}`;
      case '>':
        return `${col} > ${this.escapeLiteral(val)}`;
      case '>=':
        return `${col} >= ${this.escapeLiteral(val)}`;
      case 'in':
        if (!Array.isArray(val)) {
          throw new Error('IN operator requires array value');
        }
        const inValues = val.map((v) => this.escapeLiteral(v)).join(', ');
        return `${col} IN (${inValues})`;
      case 'not in':
        if (!Array.isArray(val)) {
          throw new Error('NOT IN operator requires array value');
        }
        const notInValues = val.map((v) => this.escapeLiteral(v)).join(', ');
        return `${col} NOT IN (${notInValues})`;
      case 'glob':
        // SQLite GLOB is case-sensitive pattern matching
        return `${col} GLOB ${this.escapeLiteral(val)}`;
      default:
        throw new Error(`Unsupported filter operator: ${op}`);
    }
  }

  private buildAggregationExpr(
    fn: 'sum' | 'avg' | 'count' | 'min' | 'max',
    field: string,
  ): string {
    const escapedField = this.escapeIdentifier(field);

    switch (fn) {
      case 'sum':
        return `SUM(${escapedField})`;
      case 'avg':
        return `AVG(${escapedField})`;
      case 'count':
        return `COUNT(${escapedField})`;
      case 'min':
        return `MIN(${escapedField})`;
      case 'max':
        return `MAX(${escapedField})`;
      default:
        throw new Error(`Unsupported aggregation function: ${fn}`);
    }
  }

  /**
   * Escape SQL identifier (table/column name) by wrapping in double quotes
   * and escaping any internal double quotes.
   */
  private escapeIdentifier(identifier: string): string {
    // SQLite uses double quotes for identifiers
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Escape SQL literal value (string, number, boolean, null).
   */
  private escapeLiteral(
    value: string | number | boolean | string[] | number[] | null,
  ): string {
    if (value === null) {
      return 'NULL';
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'string') {
      // SQLite uses single quotes for strings, escape single quotes by doubling
      return `'${value.replace(/'/g, "''")}'`;
    }

    // This shouldn't happen as arrays are handled in buildFilterCondition
    throw new Error(`Cannot escape literal value: ${value}`);
  }
}

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

import {DataSource} from '../../widgets/charts/d3/data/source';
import {Aggregation, Filter, Row} from '../../widgets/charts/d3/data/types';

/**
 * DataSource implementation that queries the Brush backend API.
 */
export class D3ChartBrushSource implements DataSource {
  private baseQuery: string;
  private traceAddress: string;
  private limit: number;

  constructor(
    baseQuery: string,
    traceAddress = 'android_telemetry.field_trace_summaries_prod.last30days',
    limit = 10000,
  ) {
    this.baseQuery = baseQuery;
    this.traceAddress = traceAddress;
    this.limit = limit;
  }

  async query(filters: Filter[], _aggregation?: Aggregation): Promise<Row[]> {
    // Build the SQL query with filters
    let query = this.baseQuery;

    // Add WHERE clause if filters exist
    if (filters.length > 0) {
      const whereConditions = filters.map((f) => {
        if (f.val === null) {
          // Null value filters - treat as IS NULL
          return `${f.col} IS NULL`;
        }

        switch (f.op) {
          case '=':
            return typeof f.val === 'string'
              ? `${f.col} = '${f.val}'`
              : `${f.col} = ${f.val}`;
          case '!=':
            return typeof f.val === 'string'
              ? `${f.col} != '${f.val}'`
              : `${f.col} != ${f.val}`;
          case '>':
            return `${f.col} > ${f.val}`;
          case '>=':
            return `${f.col} >= ${f.val}`;
          case '<':
            return `${f.col} < ${f.val}`;
          case '<=':
            return `${f.col} <= ${f.val}`;
          case 'in':
            if (Array.isArray(f.val)) {
              const values = f.val
                .map((v: string | number) =>
                  typeof v === 'string' ? `'${v}'` : v,
                )
                .join(', ');
              return `${f.col} IN (${values})`;
            }
            return '1=1'; // Invalid filter, ignore
          case 'not in':
            if (Array.isArray(f.val)) {
              const values = f.val
                .map((v: string | number) =>
                  typeof v === 'string' ? `'${v}'` : v,
                )
                .join(', ');
              return `${f.col} NOT IN (${values})`;
            }
            return '1=1'; // Invalid filter, ignore
          case 'glob':
            return `${f.col} GLOB '${f.val}'`;
          default:
            return '1=1'; // Unknown operator, ignore
        }
      });

      // Check if the query already has a WHERE clause
      const hasWhere = /\bWHERE\b/i.test(query);
      if (hasWhere) {
        query += ` AND (${whereConditions.join(' AND ')})`;
      } else {
        query += ` WHERE ${whereConditions.join(' AND ')}`;
      }
    }

    // Add LIMIT if not already present
    if (!/\bLIMIT\b/i.test(query)) {
      query += ` LIMIT ${this.limit}`;
    }

    // Send query to Brush backend
    const url = 'https://brush-googleapis.corp.google.com/v1/bigtrace/query';
    const data = {
      perfetto_sql: query,
      trace_address: this.traceAddress,
      limit: this.limit,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include', // needed for UberProxy authentication cookies
        mode: 'cors',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Convert Brush response to Row[]
      if (
        result.columnNames !== undefined &&
        result.columnNames !== null &&
        result.rows !== undefined &&
        result.rows !== null
      ) {
        return result.rows.map(
          (row: {values: Array<string | number | null>}) => {
            const rowObject: Row = {};
            result.columnNames.forEach((header: string, index: number) => {
              if (header === null) return;
              const value = row.values[index];
              const numValue = Number(value);
              rowObject[header] = isNaN(numValue) ? value : numValue;
            });
            return rowObject;
          },
        );
      }

      return [];
    } catch (error) {
      console.error('Brush query error:', error);
      throw error;
    }
  }
}

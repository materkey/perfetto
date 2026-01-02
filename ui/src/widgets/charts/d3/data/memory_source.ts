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

import * as d3 from 'd3';
import {DataSource} from './source';
import {Filter, Aggregation, Row} from './types';

export class MemorySource implements DataSource {
  constructor(private data: Row[]) {}

  async query(filters: Filter[], aggregation?: Aggregation): Promise<Row[]> {
    let result = this.applyFilters(this.data, filters);
    if (aggregation) {
      result = this.aggregate(result, aggregation);
    }
    return result;
  }

  private applyFilters(data: Row[], filters: Filter[]): Row[] {
    return data.filter((row) => {
      return filters.every((f) => {
        const value = row[f.col];
        switch (f.op) {
          case '=':
            return value === f.val;
          case '!=':
            return value !== f.val;
          case '<':
            return f.val !== null && value != null && value < f.val;
          case '<=':
            return f.val !== null && value != null && value <= f.val;
          case '>':
            return f.val !== null && value != null && value > f.val;
          case '>=':
            return f.val !== null && value != null && value >= f.val;
          case 'in':
            if (!Array.isArray(f.val)) return false;
            return (f.val as (string | number)[]).includes(
              value as string | number,
            );
          case 'not in':
            if (!Array.isArray(f.val)) return false;
            return !(f.val as (string | number)[]).includes(
              value as string | number,
            );
          case 'glob': {
            if (typeof f.val !== 'string') return false;
            const pattern = f.val.replace(/\*/g, '.*');
            return new RegExp(pattern).test(String(value));
          }
          default:
            return true;
        }
      });
    });
  }

  private aggregate(data: Row[], aggregation: Aggregation): Row[] {
    const {fn, field, groupBy} = aggregation;

    if (groupBy.length === 0) {
      // Global aggregation
      const value = this.computeAggregation(data, fn, field);
      return [{[field]: value}];
    }

    // Group by aggregation
    const grouped = d3.group(data, ...groupBy.map((col) => (d: Row) => d[col]));
    const result: Row[] = [];

    const processGroup = (
      group: Row[] | Map<unknown, unknown>,
      keys: (string | number | boolean)[],
      depth: number,
    ) => {
      if (depth === groupBy.length) {
        const value = this.computeAggregation(group as Row[], fn, field);
        const row: Row = {};
        groupBy.forEach((col, i) => {
          row[col] = keys[i];
        });
        row[field] = value;
        result.push(row);
      } else {
        for (const [key, subgroup] of group as Map<unknown, unknown>) {
          processGroup(
            subgroup as Row[] | Map<unknown, unknown>,
            [...keys, key as string | number | boolean],
            depth + 1,
          );
        }
      }
    };

    processGroup(grouped, [], 0);
    return result;
  }

  private computeAggregation(data: Row[], fn: string, field: string): number {
    const values = data.map((d) => Number(d[field])).filter((v) => !isNaN(v));

    switch (fn) {
      case 'sum':
        return d3.sum(values);
      case 'avg':
        return d3.mean(values) ?? 0;
      case 'count':
        return data.length;
      case 'min':
        return d3.min(values) ?? 0;
      case 'max':
        return d3.max(values) ?? 0;
      default:
        return 0;
    }
  }
}

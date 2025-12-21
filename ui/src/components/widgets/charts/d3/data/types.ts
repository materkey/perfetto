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

export type Filter = {
  col: string;
  op: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in' | 'glob';
  val: string | number | boolean | string[] | number[] | null;
};

/**
 * FilterGroup represents an atomic set of filters that should be
 * added/removed together. Examples:
 * - Range filter: [duration >= 100, duration <= 500]
 * - Multi-column filter: [x >= 10, x <= 20, y >= 30, y <= 40]
 * - Single filter: [category = 'Alpha']
 *
 * Each group has a unique ID and optional label for display.
 */
export type FilterGroup = {
  id: string;
  filters: Filter[];
  label?: string;
};

/**
 * Notification sent to charts when filters change.
 * Charts decide how to respond based on whether they are the source.
 */
export interface FilterNotification {
  filters: Filter[];
  sourceChartId: string;
}

export type Aggregation = {
  fn: 'sum' | 'avg' | 'count' | 'min' | 'max';
  field: string;
  groupBy: string[];
};

export type Row = Record<string, string | number | boolean | null | undefined>;

export type ChartSpec =
  | {
      type: 'bar';
      x: string;
      y: string;
      aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
    }
  | {type: 'histogram'; x: string; bins?: number}
  | {type: 'cdf'; x: string; colorBy?: string}
  | {type: 'scatter'; x: string; y: string; colorBy?: string}
  | {type: 'boxplot'; x: string; y: string}
  | {
      type: 'heatmap';
      x: string;
      y: string;
      value: string;
      aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
    }
  | {type: 'line'; x: string; y: string; colorBy?: string}
  | {
      type: 'donut';
      category: string;
      value: string;
      aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
    }
  | {type: 'violin'; x: string; y: string};

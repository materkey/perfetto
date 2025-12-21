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

import {
  ChartSpec,
  Row,
  Filter,
  Aggregation,
  FilterGroup,
  FilterNotification,
} from '../data/types';
import {DataSource} from '../data/source';
import {FilterStore} from '../data/filter_store';
import {ChartRenderer, BaseRenderer} from './base_renderer';
import {FilterSelectionStrategy, OpacitySelectionStrategy} from './selection';

export class Chart {
  private static nextId = 0;
  private readonly chartId: string;
  private data: Row[] = [];
  private unsub: () => void;
  private unsubSettings: () => void;
  private loading = false;
  private filterGroupStack: string[] = [];
  private pendingFilters: Filter[] = [];
  private batchScheduled = false;
  private currentFilters: Filter[] = [];
  private lastRenderer: ChartRenderer | null = null;
  private lastSvg: SVGElement | null = null;

  onDataChange?: (data: Row[], loading: boolean) => void;
  onFilterStateChange?: (hasActiveFilter: boolean) => void;

  constructor(
    public spec: ChartSpec,
    private source: DataSource,
    private filterStore: FilterStore,
  ) {
    this.chartId = `chart-${Chart.nextId++}`;
    this.unsub = filterStore.subscribe((notification: FilterNotification) => {
      this.handleFilterNotification(notification);
    });

    // Subscribe to settings changes (e.g., updateSourceChart toggle)
    this.unsubSettings = filterStore.subscribeToSettings(() => {
      // Re-render with the new strategy if we have a previous render
      if (this.lastSvg && this.lastRenderer) {
        this.render(this.lastSvg, this.lastRenderer);
      }
    });
  }

  /**
   * 2-phase filter handling:
   * Phase 1: Receive notification with source chart ID
   * Phase 2: Decide whether to update based on updateSourceChart setting
   */
  private handleFilterNotification(notification: FilterNotification) {
    const {filters, sourceChartId} = notification;
    const isSourceChart = sourceChartId === this.chartId;
    const updateSourceChart = this.filterStore.getUpdateSourceChart();

    this.currentFilters = filters;

    // Decide whether to update data
    // Source chart only skips update if updateSourceChart is false
    // All other charts ALWAYS update
    const shouldUpdate = !isSourceChart || updateSourceChart;

    if (shouldUpdate) {
      this.load(filters);
    } else {
      // Source chart in opacity mode: don't reload data, don't re-render
      // The opacity was already applied by OpacitySelectionStrategy during brush
      // Calling notifyChange() would trigger ChartWidget to re-render and clear opacity
    }
  }

  private async load(filters: Filter[]) {
    this.loading = true;
    this.notifyChange();

    try {
      const aggregation = this.getAggregation();
      this.data = await this.source.query(filters, aggregation);
    } catch (error) {
      console.error('Chart load error:', error);
      this.data = [];
    } finally {
      this.loading = false;
      this.notifyChange();
    }
  }

  private getAggregation(): Aggregation | undefined {
    if (this.spec.type === 'bar') {
      const groupBy = [this.spec.x];
      if (this.spec.groupBy) {
        groupBy.push(this.spec.groupBy);
      }
      return {
        fn: this.spec.aggregation,
        field: this.spec.y,
        groupBy,
      };
    }
    if (this.spec.type === 'donut') {
      return {
        fn: this.spec.aggregation,
        field: this.spec.value,
        groupBy: [this.spec.category],
      };
    }
    return undefined;
  }

  getData(): Row[] {
    return this.data;
  }

  /**
   * Get data filtered by current filters (for opacity strategy).
   * This allows renderers to apply visual filtering without reloading data.
   */
  getFilteredData(): Row[] {
    if (this.currentFilters.length === 0) {
      return this.data;
    }
    // Apply filters client-side for visual feedback
    return this.data.filter((row) => {
      return this.currentFilters.every((f) => {
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

  getCurrentFilters(): Filter[] {
    return this.currentFilters;
  }

  getChartId(): string {
    return this.chartId;
  }

  isLoading(): boolean {
    return this.loading;
  }

  render(svg: SVGElement, renderer: ChartRenderer) {
    // Store for re-rendering on settings change
    this.lastSvg = svg;
    this.lastRenderer = renderer;

    const filterRequestCallback = (
      col: string,
      op: Filter['op'],
      val: string | number | boolean | string[] | number[] | null,
    ) => {
      if (col === '__clear_all__') {
        this.clearChartFilters();
        return;
      }

      this.pendingFilters.push({col, op, val});

      if (!this.batchScheduled) {
        this.batchScheduled = true;
        queueMicrotask(() => {
          this.processPendingFilters();
        });
      }
    };

    renderer.onFilterRequest = filterRequestCallback;

    // Set the selection strategy based on updateSourceChart setting
    // Both strategies create filters (so other charts can update), but:
    // - FilterSelectionStrategy: Normal mode (source chart reloads)
    // - OpacitySelectionStrategy: Opacity mode (source chart doesn't reload)
    if (renderer instanceof BaseRenderer) {
      const updateSourceChart = this.filterStore.getUpdateSourceChart();
      const strategy = updateSourceChart
        ? new FilterSelectionStrategy()
        : new OpacitySelectionStrategy();
      renderer.setSelectionStrategy(strategy);
    }

    renderer.render(svg, this.data, this.spec);
  }

  /**
   * Process all pending filters by creating a filter group.
   */
  private processPendingFilters() {
    this.batchScheduled = false;

    if (this.pendingFilters.length === 0) {
      return;
    }

    const group: FilterGroup = {
      id: `${this.chartId}-${Date.now()}`,
      filters: [...this.pendingFilters],
      label: this.createFilterLabel(this.pendingFilters),
    };

    if (this.filterGroupStack.length > 0) {
      this.clearChartFilters();
    }

    this.filterStore.setFilterGroup(group, this.chartId);
    this.filterGroupStack.push(group.id);
    this.pendingFilters = [];

    this.notifyFilterStateChange();
  }

  /**
   * Clear all filter groups created by this chart.
   */
  private clearChartFilters() {
    for (const groupId of this.filterGroupStack) {
      this.filterStore.clearFilterGroup(groupId, this.chartId);
    }
    this.filterGroupStack = [];
    this.notifyFilterStateChange();
  }

  /**
   * Check if this chart has any active filters.
   */
  hasActiveFilters(): boolean {
    return this.filterGroupStack.length > 0;
  }

  private createFilterLabel(filters: Filter[]): string {
    if (filters.length === 1) {
      const f = filters[0];
      return `${f.col} ${f.op} ${JSON.stringify(f.val)}`;
    }

    // For range filters (>= and <=), create a nice label
    const byColumn = new Map<string, Filter[]>();
    for (const filter of filters) {
      const existing = byColumn.get(filter.col) || [];
      existing.push(filter);
      byColumn.set(filter.col, existing);
    }

    const labels: string[] = [];
    for (const [col, colFilters] of byColumn.entries()) {
      if (colFilters.length === 2) {
        const ge = colFilters.find((f) => f.op === '>=');
        const le = colFilters.find((f) => f.op === '<=');
        if (ge && le) {
          labels.push(
            `${col}: ${JSON.stringify(ge.val)} - ${JSON.stringify(le.val)}`,
          );
          continue;
        }
      }
      // Fallback: just list all filters
      for (const f of colFilters) {
        labels.push(`${f.col} ${f.op} ${JSON.stringify(f.val)}`);
      }
    }

    return labels.join(', ');
  }

  destroy() {
    this.unsub();
    this.unsubSettings();
  }

  clone(): Chart {
    return new Chart(
      JSON.parse(JSON.stringify(this.spec)),
      this.source,
      this.filterStore,
    );
  }

  private notifyChange() {
    this.onDataChange?.(this.data, this.loading);
  }

  private notifyFilterStateChange() {
    this.onFilterStateChange?.(this.hasActiveFilters());
  }
}

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

import {Filter, FilterGroup, FilterNotification} from './types';

/**
 * FilterStore manages filter groups with history support.
 *
 * Each FilterGroup is an atomic unit that can contain multiple filters.
 * This allows charts to create complex filters (e.g., range filters with
 * both >= and <= operators) that are added/removed as a single unit.
 *
 * History is maintained at the group level, making undo/redo intuitive.
 *
 * Supports 2-phase notification:
 * 1. Notify all charts with filter change and source chart ID
 * 2. Each chart decides whether to update data based on whether it's the source
 */
export class FilterStore {
  private groups = new Map<string, FilterGroup>();
  private listeners = new Set<(notification: FilterNotification) => void>();
  private history: Map<string, FilterGroup>[] = [];
  private updateSourceChart = true;
  private settingsListeners = new Set<() => void>();

  /**
   * Set or replace a filter group by ID.
   */
  setFilterGroup(group: FilterGroup, sourceChartId: string) {
    this.history.push(new Map(this.groups));
    this.groups.set(group.id, group);
    this.notify(sourceChartId);
  }

  /**
   * Remove a filter group by ID.
   */
  clearFilterGroup(id: string, sourceChartId: string) {
    this.history.push(new Map(this.groups));
    this.groups.delete(id);
    this.notify(sourceChartId);
  }

  /**
   * Remove all filter groups.
   */
  clearAll() {
    this.history.push(new Map(this.groups));
    this.groups.clear();
    this.notify('system');
  }

  /**
   * Undo the last filter operation.
   */
  undo() {
    const prev = this.history.pop();
    if (prev) {
      this.groups = prev;
      this.notify('system');
    }
  }

  /**
   * Get all filters from all groups as a flat array.
   */
  getFilters(): Filter[] {
    const result: Filter[] = [];
    for (const group of this.groups.values()) {
      result.push(...group.filters);
    }
    return result;
  }

  /**
   * Get all filter groups.
   */
  getFilterGroups(): FilterGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Get a specific filter group by ID.
   */
  getFilterGroup(id: string): FilterGroup | undefined {
    return this.groups.get(id);
  }

  /**
   * Subscribe to filter changes.
   * Callback receives a FilterNotification with filters and source chart ID.
   */
  subscribe(callback: (notification: FilterNotification) => void): () => void {
    this.listeners.add(callback);
    callback({
      filters: this.getFilters(),
      sourceChartId: 'system',
    });
    return () => this.listeners.delete(callback);
  }

  /**
   * Subscribe to settings changes (e.g., updateSourceChart toggle).
   */
  subscribeToSettings(callback: () => void): () => void {
    this.settingsListeners.add(callback);
    return () => this.settingsListeners.delete(callback);
  }

  /**
   * Get whether source chart should update when it creates a filter.
   */
  getUpdateSourceChart(): boolean {
    return this.updateSourceChart;
  }

  /**
   * Set whether source chart should update when it creates a filter.
   */
  setUpdateSourceChart(value: boolean) {
    if (this.updateSourceChart !== value) {
      this.updateSourceChart = value;
      this.notifySettings();
    }
  }

  private notify(sourceChartId: string) {
    const notification: FilterNotification = {
      filters: this.getFilters(),
      sourceChartId,
    };
    this.listeners.forEach((cb) => cb(notification));
  }

  private notifySettings() {
    this.settingsListeners.forEach((cb) => cb());
  }
}

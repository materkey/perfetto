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

import {Row, Filter} from '../../data/types';
import {SelectionStrategy, SelectionContext} from './selection_strategy';

/**
 * Strategy that applies both visual selection (opacity) AND creates filters.
 * This is the default behavior - brush creates filters and all charts refresh.
 */
export class FilterSelectionStrategy implements SelectionStrategy {
  onSelection(
    selectedData: Row[],
    filters: Filter[],
    context: SelectionContext,
  ): void {
    // 1. Apply visual selection (opacity changes)
    this.applyVisualSelection(context.g, context.allData, selectedData);

    // 2. Request filters to be created
    if (context.onFilterRequest) {
      // Clear existing filters first
      context.onFilterRequest('__clear_all__', '=', null);

      // Apply all new filters
      filters.forEach((f) => {
        context.onFilterRequest!(f.col, f.op, f.val);
      });
    }
  }

  onClear(context: SelectionContext): void {
    // 1. Clear visual selection
    this.clearVisualSelection(context.g);

    // 2. Clear filters
    if (context.onFilterRequest) {
      context.onFilterRequest('__clear_all__', '=', null);
    }
  }

  private applyVisualSelection(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    _allData: Row[],
    selectedData: Row[],
  ): void {
    const selectedSet = new Set(selectedData);
    const isEmpty = selectedData.length === 0;

    // Set opacity: 1.0 for selected items, 0.2 for non-selected
    g.selectAll('.selectable').style('opacity', (d: unknown) => {
      const isSelected = isEmpty || selectedSet.has(d as Row);
      return isSelected ? 1.0 : 0.2;
    });
  }

  private clearVisualSelection(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
  ): void {
    // Reset all items to full opacity
    g.selectAll('.selectable').style('opacity', 1.0);
  }
}

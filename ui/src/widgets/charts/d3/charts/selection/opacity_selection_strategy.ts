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
 * Strategy that ONLY applies visual selection (opacity) without creating filters.
 * This is the "highlight only" mode - brush shows selection but doesn't filter data.
 */
export class OpacitySelectionStrategy implements SelectionStrategy {
  onSelection(
    selectedData: Row[],
    filters: Filter[],
    context: SelectionContext,
  ): void {
    // 1. Apply visual selection (opacity changes)
    this.applyVisualSelection(context.g, selectedData, filters);

    // 2. CREATE filters so other charts can update
    // We create filters so other charts receive them, but the source chart
    // won't reload its data (controlled by Chart.handleFilterNotification)
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
    // Clear visual selection
    this.clearVisualSelection(context.g);

    // Also clear any existing filters so other charts reset
    if (context.onFilterRequest) {
      context.onFilterRequest('__clear_all__', '=', null);
    }
  }

  private applyVisualSelection(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    selectedData: Row[],
    filters: Filter[],
  ): void {
    const isEmpty = selectedData.length === 0;
    const selectedSet = new Set(selectedData);

    // Extract the field name from filters (for histogram bins)
    const histogramField = filters.length > 0 ? filters[0].col : null;

    // Set opacity: 1.0 for selected items, 0.2 for non-selected
    g.selectAll('.selectable').style('opacity', (d: unknown) => {
      if (isEmpty) return 1.0;

      // For histogram bins (arrays with x0/x1 properties), check if any element in the bin is selected
      // For regular data objects, use direct Set membership
      let isSelected: boolean;
      const bin = d as {x0?: number; x1?: number};
      if (Array.isArray(d) && 'x0' in bin && 'x1' in bin) {
        // This is a histogram bin
        // First try direct Set membership (works if bins weren't recreated)
        isSelected = d.some((item: unknown) => selectedSet.has(item as Row));

        if (!isSelected && d.length > 0 && histogramField) {
          // Bins were recreated after render - bin contains numeric values,
          // but selectedData contains full Row objects
          // Check if any bin value matches the field value from selected rows
          const selectedValues = new Set(
            selectedData.map((row: Row) => Number(row[histogramField])),
          );
          isSelected = d.some((binValue: unknown) => {
            const numValue =
              typeof binValue === 'number' ? binValue : Number(binValue);
            return selectedValues.has(numValue);
          });
        }
      } else {
        // Regular data object - direct Set membership
        isSelected = selectedSet.has(d as Row);
      }

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

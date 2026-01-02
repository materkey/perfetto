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
import {Row, Filter} from '../../data/types';

/**
 * Context passed to selection strategies
 */
export interface SelectionContext {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  allData: Row[];
  onFilterRequest?: (
    col: string,
    op: Filter['op'],
    val: string | number | boolean | string[] | number[] | null,
  ) => void;
  updateSourceFilter?: boolean;
}

/**
 * Strategy interface for handling brush selections.
 * Separates visual selection (opacity) from filter creation.
 */
export interface SelectionStrategy {
  /**
   * Called when a brush selection is made
   * @param selectedData The data items within the brush selection
   * @param filters The filters to apply based on the selection
   * @param context The rendering context
   */
  onSelection(
    selectedData: Row[],
    filters: Filter[],
    context: SelectionContext,
  ): void;

  /**
   * Called when the brush selection is cleared
   * @param context The rendering context
   */
  onClear(context: SelectionContext): void;
}

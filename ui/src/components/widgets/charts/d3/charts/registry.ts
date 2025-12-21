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

import {ChartRenderer} from './base_renderer';
import {BarChartRenderer} from './bar_chart';
import {HistogramRenderer} from './histogram';
import {CDFRenderer} from './cdf';
import {ScatterRenderer} from './scatter';
import {BoxplotRenderer} from './boxplot';

// Factory functions to create new renderer instances per chart
// This prevents callback collision when multiple charts share the same renderer type
export const RENDERERS: Record<string, () => ChartRenderer> = {
  bar: () => new BarChartRenderer(),
  histogram: () => new HistogramRenderer(),
  cdf: () => new CDFRenderer(),
  scatter: () => new ScatterRenderer(),
  boxplot: () => new BoxplotRenderer(),
};

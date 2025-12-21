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

import m from 'mithril';
import {Chart} from '../charts/chart';
import {RENDERERS} from '../charts/registry';
import {ChartSpec} from '../data/types';
import {Spinner} from '../../../../../widgets/spinner';

export interface ChartWidgetAttrs {
  chart: Chart;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export const ChartWidget: m.Component<ChartWidgetAttrs> = {
  oncreate({dom, attrs}) {
    const svg = dom.querySelector('svg') as SVGElement;
    const rendererFactory = RENDERERS[attrs.chart.spec.type];

    if (rendererFactory === undefined) {
      console.error(`No renderer for chart type: ${attrs.chart.spec.type}`);
      return;
    }

    // Create a new renderer instance for this chart to avoid callback collision
    const renderer = rendererFactory();

    attrs.chart.onDataChange = () => {
      console.log('[ChartWidget] onDataChange triggered');
      attrs.chart.render(svg, renderer);
      m.redraw();
    };

    attrs.chart.onFilterStateChange = (hasFilter) => {
      console.log(
        '[ChartWidget] onFilterStateChange triggered, hasFilter:',
        hasFilter,
      );
      m.redraw();
    };

    attrs.chart.render(svg, renderer);
  },

  onremove({attrs}) {
    attrs.chart.destroy();
  },

  view({attrs}) {
    const {chart} = attrs;
    const title = getChartTitle(chart.spec);
    const hasActiveFilter = chart.hasActiveFilters();

    return m(
      '.chart-container',
      {
        style:
          'position: relative; border: 1px solid #ccc; padding: 8px; background: white;',
      },
      [
        m(
          '.chart-header',
          {
            style: `display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 4px 8px; border-radius: 4px; background: ${hasActiveFilter ? 'steelblue' : 'transparent'}; color: ${hasActiveFilter ? 'white' : 'inherit'}; transition: all 0.2s ease;`,
          },
          [
            m('span.chart-title', {style: 'font-weight: bold;'}, title),
            m('.chart-actions', [
              attrs.onDuplicate !== undefined &&
                m(
                  'button',
                  {
                    onclick: attrs.onDuplicate,
                    style: 'margin-right: 4px;',
                  },
                  'Duplicate',
                ),
              attrs.onRemove !== undefined &&
                m(
                  'button',
                  {
                    onclick: attrs.onRemove,
                  },
                  '×',
                ),
            ]),
          ],
        ),
        m('svg.chart-canvas', {
          style: 'width: 100%; height: 400px; display: block;',
        }),
        chart.isLoading() &&
          m(
            '.chart-loading',
            {
              style:
                'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);',
            },
            m(Spinner),
          ),
      ],
    );
  },
};

function getChartTitle(spec: ChartSpec): string {
  switch (spec.type) {
    case 'bar':
      return `${spec.y} by ${spec.x}`;
    case 'histogram':
      return `Histogram: ${spec.x}`;
    case 'cdf':
      return `CDF: ${spec.x}`;
    case 'scatter':
      return `${spec.y} vs ${spec.x}`;
    case 'boxplot':
      return `Boxplot: ${spec.y} by ${spec.x}`;
  }
}

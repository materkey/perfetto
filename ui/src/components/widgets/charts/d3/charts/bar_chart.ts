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
import {BaseRenderer} from './base_renderer';
import {Row, ChartSpec} from '../data/types';
import {formatNumber} from '../utils';
import {CategoricalBrush} from './brushing';

export class BarChartRenderer extends BaseRenderer {
  constructor() {
    super();
    this.brushBehavior = new CategoricalBrush();
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'bar') return;

    this.clear(svg);
    const {width, height} = this.getDimensions(svg);
    const g = this.createGroup(svg);

    // Scales
    const x = d3
      .scaleBand()
      .domain(data.map((d) => String(d[spec.x])))
      .range([0, width])
      .padding(0.1);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => Number(d[spec.y])) ?? 0])
      .nice()
      .range([height, 0]);

    // Add grid lines first (so they appear behind data)
    this.addGridLines(g, x, y, width, height);

    // Add brush BEFORE bars so bars are on top and receive mouse events
    this.setupBrush(g, data, spec, {x, y}, width, height);

    // Bars
    const bars = g
      .selectAll<SVGRectElement, Row>('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar selectable')
      .attr('x', (d) => x(String(d[spec.x]))!)
      .attr('y', (d) => y(Number(d[spec.y])))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - y(Number(d[spec.y])))
      .attr('fill', 'steelblue')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        const value = d[spec.x];
        if (value !== undefined && value !== null) {
          this.onFilterRequest?.(spec.x, '=', value);
        }
      });

    // Tooltips
    this.setupTooltip(bars, (d) => {
      return `<strong>${d[spec.x]}</strong><br/>${spec.y}: ${formatNumber(Number(d[spec.y]))}`;
    });

    // Axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    g.append('g')
      .attr('class', 'y-axis')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((d) => formatNumber(Number(d))),
      );

    // Axis labels
    g.append('text')
      .attr('transform', `translate(${width / 2},${height + 35})`)
      .style('text-anchor', 'middle')
      .style('font-size', '12px')
      .text(spec.x);

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -40)
      .attr('x', -height / 2)
      .style('text-anchor', 'middle')
      .style('font-size', '12px')
      .text(spec.y);
  }
}

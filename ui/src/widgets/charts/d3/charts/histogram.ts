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
import {Row, ChartSpec, Filter} from '../data/types';
import {DataSource} from '../data/source';
import {formatNumber} from '../utils';
import {RangeBrush} from './brushing';

export class HistogramRenderer extends BaseRenderer {
  constructor() {
    super();
    this.brushBehavior = new RangeBrush();
  }

  async renderWithSource(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void> {
    if (spec.type !== 'histogram') return;

    // Query data with filters (no aggregation needed for histogram)
    const data = await source.query(filters);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'histogram') return;

    this.clear(svg);
    const {width, height} = this.getDimensions(svg);
    const g = this.createGroup(svg);

    // Extract values
    const values = data.map((d) => Number(d[spec.x])).filter((v) => !isNaN(v));

    // Create default scale (will be used even with no data for brush reset)
    let x: d3.ScaleLinear<number, number>;

    if (values.length === 0) {
      x = d3.scaleLinear().domain([0, 100]).range([0, width]);

      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .style('text-anchor', 'middle')
        .text('No data');

      // Still render brush so user can reset filter
      this.setupBrush(g, data, spec, {x}, width, height);
      return;
    }

    // Create bins
    const bins = d3
      .bin()
      .domain(d3.extent(values) as [number, number])
      .thresholds(spec.bins ?? 20)(values);

    // Scales
    x = d3
      .scaleLinear()
      .domain([bins[0].x0!, bins[bins.length - 1].x1!])
      .range([0, width]);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (d) => d.length) ?? 0])
      .nice()
      .range([height, 0]);

    // Add grid lines first (so they appear behind data)
    // Histograms only show horizontal grid lines
    this.addGridLines(g, x, y, width, height, false);

    // Add brush BEFORE bars so bars are on top and receive mouse events
    this.setupBrush(g, data, spec, {x}, width, height);

    // Bars
    const bars = g
      .selectAll<SVGRectElement, d3.Bin<number, number>>('.bar')
      .data(bins)
      .join('rect')
      .attr('class', 'bar selectable')
      .attr('x', (d) => x(d.x0!) + 1)
      .attr('y', (d) => y(d.length))
      .attr('width', (d) => Math.max(0, x(d.x1!) - x(d.x0!) - 2))
      .attr('height', (d) => height - y(d.length))
      .attr('fill', 'steelblue')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        if (d.x0 !== undefined && d.x1 !== undefined) {
          // Set range filter
          this.onFilterRequest?.(spec.x, '>=', d.x0);
          this.onFilterRequest?.(spec.x, '<', d.x1);
        }
      });

    // Tooltips
    this.setupTooltip(bars, (d) => {
      return `Range: ${formatNumber(d.x0!)} - ${formatNumber(d.x1!)}<br/>Count: ${d.length}`;
    });

    // Axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(10)
          .tickFormat((d) => formatNumber(Number(d))),
      );

    g.append('g').attr('class', 'y-axis').call(d3.axisLeft(y).ticks(5));

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
      .text('Frequency');
  }
}

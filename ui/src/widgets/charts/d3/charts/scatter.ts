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
import {ScatterBrush} from './brushing';

export class ScatterRenderer extends BaseRenderer {
  constructor() {
    super();
    this.brushBehavior = new ScatterBrush();
  }

  async renderWithSource(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void> {
    if (spec.type !== 'scatter') return;

    // Query data with filters (no aggregation needed for scatter plot)
    const data = await source.query(filters);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'scatter') return;

    this.clear(svg);
    const {width, height} = this.getDimensions(svg);
    const g = this.createGroup(svg);

    // Extract values
    const xValues = data.map((d) => Number(d[spec.x])).filter((v) => !isNaN(v));
    const yValues = data.map((d) => Number(d[spec.y])).filter((v) => !isNaN(v));

    // Create default scales (will be used even with no data for brush reset)
    const x = d3
      .scaleLinear()
      .domain(
        xValues.length > 0
          ? (d3.extent(xValues) as [number, number])
          : [0, 100],
      )
      .nice()
      .range([0, width]);

    const y = d3
      .scaleLinear()
      .domain(
        yValues.length > 0
          ? (d3.extent(yValues) as [number, number])
          : [0, 100],
      )
      .nice()
      .range([height, 0]);

    if (xValues.length === 0 || yValues.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .style('text-anchor', 'middle')
        .text('No data');

      // Still render brush so user can reset filter
      this.setupBrush(g, data, spec, {x, y}, width, height);
      return;
    }

    // Add grid lines first (so they appear behind data)
    this.addGridLines(g, x, y, width, height);

    // Add brush BEFORE points so points are on top and receive mouse events
    this.setupBrush(g, data, spec, {x, y}, width, height);

    // Color scale (if colorBy is specified)
    let colorScale: d3.ScaleOrdinal<string, string> | undefined;
    if (spec.colorBy) {
      const categories = Array.from(
        new Set(data.map((d) => String(d[spec.colorBy!]))),
      );
      colorScale = d3
        .scaleOrdinal<string>()
        .domain(categories)
        .range(d3.schemeCategory10);
    }

    // Draw points
    const points = g
      .selectAll<SVGCircleElement, Row>('.point')
      .data(data)
      .join('circle')
      .attr('class', 'point selectable')
      .attr('cx', (d) => x(Number(d[spec.x])))
      .attr('cy', (d) => y(Number(d[spec.y])))
      .attr('r', 4)
      .attr('fill', (d) => {
        if (spec.colorBy && colorScale) {
          return colorScale(String(d[spec.colorBy]));
        }
        return 'steelblue';
      })
      .attr('stroke', 'white')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        if (spec.colorBy) {
          const value = d[spec.colorBy];
          if (value !== undefined && value !== null) {
            this.onFilterRequest?.(spec.colorBy, '=', value);
          }
        }
      });

    // Tooltips
    this.setupTooltip(points, (d) => {
      let html = `<strong>${spec.x}:</strong> ${formatNumber(Number(d[spec.x]))}<br/>`;
      html += `<strong>${spec.y}:</strong> ${formatNumber(Number(d[spec.y]))}`;
      if (spec.colorBy) {
        html += `<br/><strong>${spec.colorBy}:</strong> ${d[spec.colorBy]}`;
      }
      return html;
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

    g.append('g')
      .attr('class', 'y-axis')
      .call(
        d3
          .axisLeft(y)
          .ticks(10)
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

    // Draw correlation line and coefficient (if enabled in spec, default true)
    const showCorrelation = spec.showCorrelation ?? true;
    if (showCorrelation) {
      this.drawCorrelationLine(g, data, spec, x, y, width);
    }

    // Legend (if colorBy is specified)
    if (spec.colorBy && colorScale) {
      const categories = colorScale.domain();
      const legend = g
        .append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(${width - 100}, 10)`);

      categories.forEach((category, i) => {
        const legendRow = legend
          .append('g')
          .attr('transform', `translate(0, ${i * 20})`)
          .style('cursor', 'pointer')
          .on('click', () => {
            this.onFilterRequest?.(spec.colorBy!, '=', category);
          });

        legendRow
          .append('circle')
          .attr('cx', 5)
          .attr('cy', 5)
          .attr('r', 4)
          .attr('fill', colorScale!(category))
          .attr('opacity', 1.0);

        legendRow
          .append('text')
          .attr('x', 15)
          .attr('y', 9)
          .style('font-size', '11px')
          .text(category);
      });
    }
  }

  private drawCorrelationLine(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'scatter'}>,
    xScale: d3.ScaleLinear<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    width: number,
  ) {
    if (data.length < 2) return;

    // Calculate correlation
    const {r, slope, intercept} = this.calculateCorrelation(data, spec);

    // Draw regression line
    const xDomain = xScale.domain();
    const x1 = xDomain[0];
    const x2 = xDomain[1];
    const y1 = slope * x1 + intercept;
    const y2 = slope * x2 + intercept;

    g.append('line')
      .attr('class', 'correlation-line')
      .attr('x1', xScale(x1))
      .attr('y1', yScale(y1))
      .attr('x2', xScale(x2))
      .attr('y2', yScale(y2))
      .attr('stroke', '#666666')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,5')
      .attr('opacity', 0.7);

    // Display correlation coefficient
    g.append('text')
      .attr('class', 'correlation-text')
      .attr('x', width - 10)
      .attr('y', 15)
      .attr('text-anchor', 'end')
      .style('font-size', '12px')
      .style('fill', '#666666')
      .style('font-weight', 'bold')
      .text(`r = ${r.toFixed(3)}`);
  }

  private calculateCorrelation(
    data: Row[],
    spec: Extract<ChartSpec, {type: 'scatter'}>,
  ): {r: number; slope: number; intercept: number} {
    const n = data.length;
    if (n < 2) return {r: 0, slope: 0, intercept: 0};

    const xValues = data.map((d) => Number(d[spec.x]));
    const yValues = data.map((d) => Number(d[spec.y]));

    const xMean = d3.mean(xValues) ?? 0;
    const yMean = d3.mean(yValues) ?? 0;

    // Calculate Pearson correlation coefficient
    const numerator = d3.sum(
      data,
      (d) => (Number(d[spec.x]) - xMean) * (Number(d[spec.y]) - yMean),
    );

    const xSumSquares = d3.sum(xValues, (x) => Math.pow(x - xMean, 2));
    const ySumSquares = d3.sum(yValues, (y) => Math.pow(y - yMean, 2));

    const denominator = Math.sqrt(xSumSquares * ySumSquares);
    const r = denominator === 0 ? 0 : numerator / denominator;

    // Calculate linear regression slope and intercept
    const slope = xSumSquares === 0 ? 0 : numerator / xSumSquares;
    const intercept = yMean - slope * xMean;

    return {r, slope, intercept};
  }
}

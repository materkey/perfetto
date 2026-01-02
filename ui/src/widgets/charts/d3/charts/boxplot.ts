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
import {SelectionClipPaths} from './selection_clip_paths';

interface BoxplotData {
  category: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
}

export class BoxplotRenderer extends BaseRenderer {
  private clipPaths: SelectionClipPaths | null = null;

  async renderWithSource(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void> {
    if (spec.type !== 'boxplot') return;

    // Query data with filters (no aggregation needed for boxplot)
    const data = await source.query(filters);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'boxplot') return;

    this.clear(svg);

    // Initialize SelectionClipPaths AFTER clearing
    const svgSelection = d3.select(svg);
    this.clipPaths = new SelectionClipPaths(
      svgSelection as unknown as d3.Selection<
        SVGSVGElement,
        unknown,
        null,
        undefined
      >,
    );

    const {width, height} = this.getDimensions(svg);
    const g = this.createGroup(svg);

    // Group data by x (category) and calculate boxplot statistics for y values
    const grouped = d3.group(data, (d) => String(d[spec.x]));
    const boxplotData: BoxplotData[] = [];

    grouped.forEach((values, category) => {
      const yValues = values
        .map((d) => Number(d[spec.y]))
        .filter((v) => !isNaN(v))
        .sort(d3.ascending);

      if (yValues.length === 0) return;

      const q1 = d3.quantile(yValues, 0.25) ?? 0;
      const median = d3.quantile(yValues, 0.5) ?? 0;
      const q3 = d3.quantile(yValues, 0.75) ?? 0;
      const iqr = q3 - q1;
      const minValue = Math.max(d3.min(yValues) ?? 0, q1 - 1.5 * iqr);
      const maxValue = Math.min(d3.max(yValues) ?? 0, q3 + 1.5 * iqr);
      const outliers = yValues.filter((v) => v < minValue || v > maxValue);

      boxplotData.push({
        category,
        min: minValue,
        q1,
        median,
        q3,
        max: maxValue,
        outliers,
      });
    });

    if (boxplotData.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .style('text-anchor', 'middle')
        .text('No data');
      return;
    }

    // Scales
    const x = d3
      .scaleBand()
      .domain(boxplotData.map((d) => d.category))
      .range([0, width])
      .padding(0.2);

    const allValues = boxplotData.flatMap((d) => [d.min, d.max, ...d.outliers]);
    const y = d3
      .scaleLinear()
      .domain([d3.min(allValues) ?? 0, d3.max(allValues) ?? 100])
      .range([height, 0])
      .nice();

    // Add grid lines first (so they appear behind data)
    this.addGridLines(g, x, y, width, height, false);

    // Setup brush with clip path highlighting
    this.setupBoxplotBrush(g, boxplotData, data, spec, {x, y}, width, height);

    // Draw boxplots with pointer-events: none so brush works
    this.drawBoxplots(g, boxplotData, spec, x, y, width, height);

    // Axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x));

    g.append('g')
      .attr('class', 'y-axis')
      .call(d3.axisLeft(y).tickFormat((d) => formatNumber(Number(d))));

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

  private drawBoxplots(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    boxplotData: BoxplotData[],
    spec: Extract<ChartSpec, {type: 'boxplot'}>,
    x: d3.ScaleBand<string>,
    y: d3.ScaleLinear<number, number>,
    _width: number,
    _height: number,
    opacity: number = 1.0,
  ) {
    const boxWidth = x.bandwidth();

    const boxGroups = container
      .selectAll('.boxplot-group')
      .data(boxplotData)
      .enter()
      .append('g')
      .attr('class', 'boxplot-group')
      .attr('transform', (d) => `translate(${x(d.category)}, 0)`)
      .style('opacity', opacity)
      .style('pointer-events', 'all');

    // Lower whisker line (from min to Q1)
    boxGroups
      .append('line')
      .attr('class', 'whisker-lower')
      .attr('x1', boxWidth / 2)
      .attr('x2', boxWidth / 2)
      .attr('y1', (d) => y(d.min))
      .attr('y2', (d) => y(d.q1))
      .attr('stroke', 'black')
      .attr('stroke-width', 1);

    // Min whisker cap
    boxGroups
      .append('line')
      .attr('x1', boxWidth / 4)
      .attr('x2', (3 * boxWidth) / 4)
      .attr('y1', (d) => y(d.min))
      .attr('y2', (d) => y(d.min))
      .attr('stroke', 'black')
      .attr('stroke-width', 1);

    // Upper whisker line (from Q3 to max)
    boxGroups
      .append('line')
      .attr('class', 'whisker-upper')
      .attr('x1', boxWidth / 2)
      .attr('x2', boxWidth / 2)
      .attr('y1', (d) => y(d.q3))
      .attr('y2', (d) => y(d.max))
      .attr('stroke', 'black')
      .attr('stroke-width', 1);

    // Max whisker cap
    boxGroups
      .append('line')
      .attr('x1', boxWidth / 4)
      .attr('x2', (3 * boxWidth) / 4)
      .attr('y1', (d) => y(d.max))
      .attr('y2', (d) => y(d.max))
      .attr('stroke', 'black')
      .attr('stroke-width', 1);

    // Box (IQR) - draw after whisker so it covers the line
    boxGroups
      .append('rect')
      .attr('class', 'box')
      .attr('x', 0)
      .attr('y', (d) => y(d.q3))
      .attr('width', boxWidth)
      .attr('height', (d) => y(d.q1) - y(d.q3))
      .attr('stroke', 'black')
      .attr('stroke-width', 1)
      .attr('fill', 'steelblue')
      .attr('fill-opacity', 0.7);

    // Median line
    boxGroups
      .append('line')
      .attr('class', 'median')
      .attr('x1', 0)
      .attr('x2', boxWidth)
      .attr('y1', (d) => y(d.median))
      .attr('y2', (d) => y(d.median))
      .attr('stroke', 'black')
      .attr('stroke-width', 2);

    // Outliers
    boxGroups.each((d, i, nodes) => {
      d3.select(nodes[i])
        .selectAll('.outlier')
        .data(d.outliers)
        .enter()
        .append('circle')
        .attr('class', 'outlier')
        .attr('cx', boxWidth / 2)
        .attr('cy', (outlier) => y(outlier))
        .attr('r', 3)
        .attr('fill', 'red')
        .attr('fill-opacity', 0.6);
    });

    // Tooltips
    this.setupTooltip(boxGroups, (d: BoxplotData) => {
      return `
        <strong>${spec.x}:</strong> ${d.category}<br>
        <strong>Max:</strong> ${formatNumber(d.max)}<br>
        <strong>Q3:</strong> ${formatNumber(d.q3)}<br>
        <strong>Median:</strong> ${formatNumber(d.median)}<br>
        <strong>Q1:</strong> ${formatNumber(d.q1)}<br>
        <strong>Min:</strong> ${formatNumber(d.min)}<br>
        <strong>Outliers:</strong> ${d.outliers.length}
      `;
    });
  }

  private setupBoxplotBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    boxplotData: BoxplotData[],
    data: Row[],
    spec: Extract<ChartSpec, {type: 'boxplot'}>,
    scales: {
      x: d3.ScaleBand<string>;
      y: d3.ScaleLinear<number, number>;
    },
    width: number,
    height: number,
  ) {
    const clearBrushVisuals = () => {
      g.selectAll('.boxplot-dimmed').remove();
      g.selectAll('.boxplot-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.boxplot-group').style('opacity', 1);
    };

    const brush = d3
      .brush()
      .extent([
        [0, 0],
        [width, height],
      ])
      .on('end', (event: d3.D3BrushEvent<unknown>) => {
        if (event.selection === null) {
          clearBrushVisuals();
          if (this.selectionStrategy !== undefined) {
            this.selectionStrategy.onClear({
              g,
              allData: data,
              onFilterRequest: this.onFilterRequest,
            });
          }
          return;
        }

        const [[x0, y0], [x1, y1]] = event.selection as [
          [number, number],
          [number, number],
        ];
        const minY = scales.y.invert(y1);
        const maxY = scales.y.invert(y0);

        // Find selected categories
        const selectedCategories: string[] = [];
        boxplotData.forEach((d) => {
          const categoryX = scales.x(d.category);
          const categoryWidth = scales.x.bandwidth();
          if (
            categoryX !== undefined &&
            x0 < categoryX + categoryWidth &&
            x1 > categoryX
          ) {
            selectedCategories.push(d.category);
          }
        });

        // Remove previous layers
        g.selectAll('.boxplot-dimmed').remove();
        g.selectAll('.boxplot-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths (OpacitySelectionStrategy)
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original boxplots
          g.selectAll('.boxplot-group').style('opacity', 0);

          // Draw dimmed version
          this.drawBoxplots(
            g.append('g').attr('class', 'boxplot-dimmed'),
            boxplotData,
            spec,
            scales.x,
            scales.y,
            width,
            height,
            0.2,
          );

          // Create clip path for highlighted region
          if (this.clipPaths) {
            const clipUrl = this.clipPaths.createRectClip(
              x0,
              y0,
              x1 - x0,
              y1 - y0,
            );

            // Draw highlighted version with clip path
            this.drawBoxplots(
              g
                .append('g')
                .attr('class', 'boxplot-highlight')
                .attr('clip-path', clipUrl),
              boxplotData,
              spec,
              scales.x,
              scales.y,
              width,
              height,
              1.0,
            );
          }
        } else {
          // Just dim slightly for FilterSelectionStrategy
          g.selectAll('.boxplot-group').style('opacity', 0.7);
        }

        // Create filters
        const filters = [];
        filters.push({col: spec.y, op: '>=' as const, val: minY});
        filters.push({col: spec.y, op: '<=' as const, val: maxY});

        if (
          selectedCategories.length > 0 &&
          selectedCategories.length < boxplotData.length
        ) {
          filters.push({
            col: spec.x,
            op: 'in' as const,
            val: selectedCategories,
          });
        }

        // Use strategy pattern for selection handling
        if (this.selectionStrategy !== undefined) {
          this.selectionStrategy.onSelection([], filters, {
            g,
            allData: data,
            onFilterRequest: this.onFilterRequest,
          });
        }
      });

    g.append('g').attr('class', 'brush').call(brush);

    // Add click-to-clear
    g.on('click', (event: MouseEvent) => {
      if (
        event.target === event.currentTarget ||
        d3.select(event.target as Element).classed('overlay')
      ) {
        const brushGroup = g.select('.brush');
        brush.clear(
          brushGroup as unknown as d3.Selection<
            SVGGElement,
            unknown,
            null,
            undefined
          >,
        );
        clearBrushVisuals();
        if (this.selectionStrategy !== undefined) {
          this.selectionStrategy.onClear({
            g,
            allData: data,
            onFilterRequest: this.onFilterRequest,
          });
        }
      }
    });
  }
}

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
import {SelectionClipPaths} from './selection_clip_paths';

interface ViolinData {
  category: string;
  density: [number, number][]; // [value, density] pairs
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  p90: number;
  p95: number;
  p99: number;
}

export class ViolinRenderer extends BaseRenderer {
  private clipPaths: SelectionClipPaths | null = null;

  async renderWithSource(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void> {
    if (spec.type !== 'violin') return;

    // Query data with filters (no aggregation needed for violin plot)
    const data = await source.query(filters);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'violin') return;

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

    // Compute violin statistics for each category
    const violinData = this.computeViolinData(data, spec.x, spec.y);

    // Scales
    const x = d3
      .scaleBand()
      .domain(violinData.map((d) => d.category))
      .range([0, width])
      .padding(0.1);

    // Collect all Y values for domain
    const allYValues: number[] = [];
    violinData.forEach((d) => {
      allYValues.push(d.min, d.max, d.q1, d.median, d.q3, d.p90, d.p95, d.p99);
      d.density.forEach((p) => allYValues.push(p[0]));
    });

    const y = d3
      .scaleLinear()
      .domain([d3.min(allYValues) ?? 0, d3.max(allYValues) ?? 100])
      .nice()
      .range([height, 0]);

    // Add grid lines first
    this.addGridLines(g, x, y, width, height, false);

    // Setup brush with clip path highlighting
    this.setupViolinBrush(g, violinData, data, spec, {x, y}, width, height);

    // Draw violins with pointer-events: none so brush works
    this.drawViolins(g, violinData, spec, x, y, width, height);

    // Axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

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
      .text(spec.y);
  }

  private computeViolinData(
    data: Row[],
    xCol: string,
    yCol: string,
  ): ViolinData[] {
    // Group data by category
    const grouped = d3.group(data, (d) => String(d[xCol]));
    const result: ViolinData[] = [];

    for (const [category, rows] of grouped) {
      const values = rows
        .map((r) => Number(r[yCol]))
        .filter((v) => !isNaN(v))
        .sort(d3.ascending);

      if (values.length === 0) continue;

      // Compute statistics
      const min = d3.min(values) ?? 0;
      const max = d3.max(values) ?? 0;
      const q1 = d3.quantile(values, 0.25) ?? 0;
      const median = d3.quantile(values, 0.5) ?? 0;
      const q3 = d3.quantile(values, 0.75) ?? 0;
      const p90 = d3.quantile(values, 0.9) ?? 0;
      const p95 = d3.quantile(values, 0.95) ?? 0;
      const p99 = d3.quantile(values, 0.99) ?? 0;

      // Compute kernel density estimation
      const density = this.kernelDensityEstimator(
        this.epanechnikovKernel(0.5),
        d3.ticks(min, max, 50),
      )(values);

      result.push({
        category,
        density,
        min,
        max,
        q1,
        median,
        q3,
        p90,
        p95,
        p99,
      });
    }

    return result;
  }

  private kernelDensityEstimator(
    kernel: (v: number) => number,
    X: number[],
  ): (V: number[]) => [number, number][] {
    return (V: number[]) => {
      return X.map((x) => [x, d3.mean(V, (v) => kernel(x - v)) ?? 0]);
    };
  }

  private epanechnikovKernel(bandwidth: number): (v: number) => number {
    return (v: number) => {
      const u = v / bandwidth;
      return Math.abs(u) <= 1 ? (0.75 * (1 - u * u)) / bandwidth : 0;
    };
  }

  private drawViolins(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    violinData: ViolinData[],
    spec: Extract<ChartSpec, {type: 'violin'}>,
    xScale: d3.ScaleBand<string>,
    yScale: d3.ScaleLinear<number, number>,
    _width: number,
    _height: number,
    opacity: number = 1.0,
  ) {
    // Find max density for scaling
    const maxDensity =
      d3.max(violinData, (d) => d3.max(d.density, (p) => p[1])) ?? 1;

    const xNum = d3
      .scaleLinear()
      .domain([0, maxDensity])
      .range([0, xScale.bandwidth() / 2]);

    const area = d3
      .area<[number, number]>()
      .x0((d) => -xNum(d[1]))
      .x1((d) => xNum(d[1]))
      .y((d) => yScale(d[0]))
      .curve(d3.curveCatmullRom);

    const violinGroups = container
      .selectAll<SVGGElement, ViolinData>('.violin-group')
      .data(violinData)
      .enter()
      .append('g')
      .attr('class', 'violin-group')
      .attr(
        'transform',
        (d: ViolinData) =>
          `translate(${(xScale(d.category) ?? 0) + xScale.bandwidth() / 2}, 0)`,
      )
      .style('opacity', opacity)
      .style('pointer-events', 'all');

    // Violin shape
    violinGroups
      .append('path')
      .datum((d) => d.density)
      .attr('d', area)
      .style('fill', 'steelblue')
      .style('opacity', 0.7);

    // IQR line (Q1 to Q3)
    violinGroups
      .append('line')
      .attr('x1', 0)
      .attr('x2', 0)
      .attr('y1', (d) => yScale(d.q1))
      .attr('y2', (d) => yScale(d.q3))
      .attr('stroke', 'black')
      .style('stroke-width', 2);

    // Median (white)
    violinGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', (d) => yScale(d.median))
      .attr('r', 3)
      .style('fill', 'white')
      .style('stroke', 'black');

    // P90 (orange)
    violinGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', (d) => yScale(d.p90))
      .attr('r', 3)
      .style('fill', 'orange');

    // P95 (red)
    violinGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', (d) => yScale(d.p95))
      .attr('r', 3)
      .style('fill', 'red');

    // P99 (purple)
    violinGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', (d) => yScale(d.p99))
      .attr('r', 3)
      .style('fill', 'purple');

    // Tooltips
    this.setupTooltip(violinGroups, (d: ViolinData) => {
      return `<strong>${spec.x}:</strong> ${d.category}<br/><strong>Median:</strong> ${d.median.toFixed(2)}<br/><strong>Q1:</strong> ${d.q1.toFixed(2)}<br/><strong>Q3:</strong> ${d.q3.toFixed(2)}<br/><strong>P90:</strong> ${d.p90.toFixed(2)}<br/><strong>P95:</strong> ${d.p95.toFixed(2)}<br/><strong>P99:</strong> ${d.p99.toFixed(2)}`;
    });
  }

  private setupViolinBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    violinData: ViolinData[],
    data: Row[],
    spec: Extract<ChartSpec, {type: 'violin'}>,
    scales: {
      x: d3.ScaleBand<string>;
      y: d3.ScaleLinear<number, number>;
    },
    width: number,
    height: number,
  ) {
    const clearBrushVisuals = () => {
      g.selectAll('.violin-dimmed').remove();
      g.selectAll('.violin-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.violin-group').style('opacity', 1);
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
        violinData.forEach((d) => {
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
        g.selectAll('.violin-dimmed').remove();
        g.selectAll('.violin-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths (OpacitySelectionStrategy)
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original violins
          g.selectAll('.violin-group').style('opacity', 0);

          // Draw dimmed version
          this.drawViolins(
            g.append('g').attr('class', 'violin-dimmed'),
            violinData,
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
            this.drawViolins(
              g
                .append('g')
                .attr('class', 'violin-highlight')
                .attr('clip-path', clipUrl),
              violinData,
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
          g.selectAll('.violin-group').style('opacity', 0.7);
        }

        // Create filters
        const filters = [];
        filters.push({col: spec.y, op: '>=' as const, val: minY});
        filters.push({col: spec.y, op: '<=' as const, val: maxY});

        if (
          selectedCategories.length > 0 &&
          selectedCategories.length < violinData.length
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

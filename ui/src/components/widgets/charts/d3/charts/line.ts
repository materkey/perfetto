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
import {SelectionClipPaths} from './selection_clip_paths';

export class LineRenderer extends BaseRenderer {
  private clipPaths: SelectionClipPaths | null = null;

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'line') return;

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

    // Extract and sort data points by x
    const points = data
      .map((d) => ({
        x: Number(d[spec.x]),
        y: Number(d[spec.y]),
        colorBy: spec.colorBy ? String(d[spec.colorBy]) : 'default',
      }))
      .filter((p) => !isNaN(p.x) && !isNaN(p.y));

    if (points.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .style('text-anchor', 'middle')
        .text('No data');
      return;
    }

    if (spec.colorBy) {
      this.renderColoredLine(g, points, data, spec, width, height);
    } else {
      this.renderSingleLine(g, points, data, spec, width, height);
    }
  }

  private renderSingleLine(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    points: Array<{x: number; y: number; colorBy: string}>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'line'}>,
    width: number,
    height: number,
  ) {
    // Sort points by x
    const sortedPoints = points.sort((a, b) => a.x - b.x);

    // Scales
    const x = d3
      .scaleLinear()
      .domain(d3.extent(sortedPoints, (d) => d.x) as [number, number])
      .range([0, width]);

    const y = d3
      .scaleLinear()
      .domain(d3.extent(sortedPoints, (d) => d.y) as [number, number])
      .range([height, 0])
      .nice();

    // Add grid lines first
    this.addGridLines(g, x, y, width, height);

    // Line generator
    const line = d3
      .line<{x: number; y: number}>()
      .x((d) => x(d.x))
      .y((d) => y(d.y));

    // Setup brush with clip path highlighting BEFORE drawing line
    this.setupLineBrush(g, sortedPoints, data, spec, {x, y}, width, height, line);

    // Draw line with pointer-events: none
    g.append('path')
      .datum(sortedPoints)
      .attr('class', 'line-path')
      .attr('fill', 'none')
      .attr('stroke', 'steelblue')
      .attr('stroke-width', 2)
      .attr('d', line)
      .style('pointer-events', 'none');

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
  }

  private renderColoredLine(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    points: Array<{x: number; y: number; colorBy: string}>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'line'}>,
    width: number,
    height: number,
  ) {
    // Group by color
    const grouped = d3.group(points, (d) => d.colorBy);
    const categories = Array.from(grouped.keys());

    // Color scale
    const colorScale = d3
      .scaleOrdinal<string>()
      .domain(categories)
      .range(d3.schemeCategory10);

    // Get global extent for scales
    const x = d3
      .scaleLinear()
      .domain(d3.extent(points, (d) => d.x) as [number, number])
      .range([0, width]);

    const y = d3
      .scaleLinear()
      .domain(d3.extent(points, (d) => d.y) as [number, number])
      .range([height, 0])
      .nice();

    // Add grid lines first
    this.addGridLines(g, x, y, width, height);

    // Line generator
    const line = d3
      .line<{x: number; y: number}>()
      .x((d) => x(d.x))
      .y((d) => y(d.y));

    // Setup brush BEFORE drawing lines
    this.setupColoredLineBrush(
      g,
      points,
      data,
      spec,
      {x, y},
      width,
      height,
      line,
      colorScale,
    );

    // Draw lines for each category with pointer-events: none
    grouped.forEach((groupPoints, category) => {
      const sortedPoints = groupPoints.sort((a, b) => a.x - b.x);

      g.append('path')
        .datum(sortedPoints)
        .attr('class', 'line-path')
        .attr('fill', 'none')
        .attr('stroke', colorScale(category))
        .attr('stroke-width', 2)
        .attr('d', line)
        .style('pointer-events', 'none')
        .style('cursor', 'pointer')
        .on('click', () => {
          if (spec.colorBy) {
            this.onFilterRequest?.(spec.colorBy, '=', category);
          }
        });
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

    // Legend
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
          if (spec.colorBy) {
            this.onFilterRequest?.(spec.colorBy, '=', category);
          }
        });

      legendRow
        .append('rect')
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', colorScale(category));

      legendRow
        .append('text')
        .attr('x', 15)
        .attr('y', 9)
        .style('font-size', '11px')
        .text(String(category).substring(0, 20));
    });
  }

  private setupLineBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    linePoints: Array<{x: number; y: number}>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'line'}>,
    scales: {
      x: d3.ScaleLinear<number, number>;
      y: d3.ScaleLinear<number, number>;
    },
    width: number,
    height: number,
    line: d3.Line<{x: number; y: number}>,
  ) {
    const clearBrushVisuals = () => {
      g.selectAll('.line-dimmed').remove();
      g.selectAll('.line-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.line-path').style('opacity', 1);
    };

    const brush = d3
      .brushX()
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

        const [x0, x1] = event.selection as [number, number];
        const minValue = scales.x.invert(x0);
        const maxValue = scales.x.invert(x1);

        // Remove previous layers
        g.selectAll('.line-dimmed').remove();
        g.selectAll('.line-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original line
          g.selectAll('.line-path').style('opacity', 0);

          // Draw dimmed version
          g.append('path')
            .datum(linePoints)
            .attr('class', 'line-dimmed')
            .attr('fill', 'none')
            .attr('stroke', 'steelblue')
            .attr('stroke-width', 2)
            .attr('d', line)
            .style('opacity', 0.2);

          // Create clip path for highlighted region
          if (this.clipPaths) {
            const clipUrl = this.clipPaths.createRectClip(
              x0,
              0,
              x1 - x0,
              height,
            );

            // Draw highlighted version with clip path
            g.append('path')
              .datum(linePoints)
              .attr('class', 'line-highlight')
              .attr('fill', 'none')
              .attr('stroke', 'steelblue')
              .attr('stroke-width', 2)
              .attr('d', line)
              .attr('clip-path', clipUrl);
          }
        } else {
          // Just dim slightly for FilterSelectionStrategy
          g.selectAll('.line-path').style('opacity', 0.7);
        }

        // Create filters
        const filters = [
          {col: spec.x, op: '>=' as const, val: minValue},
          {col: spec.x, op: '<=' as const, val: maxValue},
        ];

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
        brush.clear(brushGroup as unknown as d3.Selection<SVGGElement, unknown, null, undefined>);
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

  private setupColoredLineBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    linePoints: Array<{x: number; y: number; colorBy: string}>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'line'}>,
    scales: {
      x: d3.ScaleLinear<number, number>;
      y: d3.ScaleLinear<number, number>;
    },
    width: number,
    height: number,
    line: d3.Line<{x: number; y: number}>,
    colorScale: d3.ScaleOrdinal<string, string>,
  ) {
    // Group data by color for redrawing
    const grouped = d3.group(linePoints, (d) => d.colorBy);

    const clearBrushVisuals = () => {
      g.selectAll('.line-dimmed').remove();
      g.selectAll('.line-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.line-path').style('opacity', 1);
    };

    const brush = d3
      .brushX()
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

        const [x0, x1] = event.selection as [number, number];
        const minValue = scales.x.invert(x0);
        const maxValue = scales.x.invert(x1);

        // Remove previous layers
        g.selectAll('.line-dimmed').remove();
        g.selectAll('.line-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original lines
          g.selectAll('.line-path').style('opacity', 0);

          // Draw dimmed versions for each group
          grouped.forEach((groupPoints, category) => {
            const sortedPoints = groupPoints.sort((a, b) => a.x - b.x);

            g.append('path')
              .datum(sortedPoints)
              .attr('class', 'line-dimmed')
              .attr('fill', 'none')
              .attr('stroke', colorScale(category))
              .attr('stroke-width', 2)
              .attr('d', line)
              .style('opacity', 0.2);
          });

          // Create clip path for highlighted region
          if (this.clipPaths) {
            const clipUrl = this.clipPaths.createRectClip(
              x0,
              0,
              x1 - x0,
              height,
            );

            // Draw highlighted versions with clip path
            grouped.forEach((groupPoints, category) => {
              const sortedPoints = groupPoints.sort((a, b) => a.x - b.x);

              g.append('path')
                .datum(sortedPoints)
                .attr('class', 'line-highlight')
                .attr('fill', 'none')
                .attr('stroke', colorScale(category))
                .attr('stroke-width', 2)
                .attr('d', line)
                .attr('clip-path', clipUrl);
            });
          }
        } else {
          // Just dim slightly for FilterSelectionStrategy
          g.selectAll('.line-path').style('opacity', 0.7);
        }

        // Create filters
        const filters = [
          {col: spec.x, op: '>=' as const, val: minValue},
          {col: spec.x, op: '<=' as const, val: maxValue},
        ];

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
        brush.clear(brushGroup as unknown as d3.Selection<SVGGElement, unknown, null, undefined>);
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

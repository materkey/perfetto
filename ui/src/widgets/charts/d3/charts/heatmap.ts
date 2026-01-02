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
import {Row, ChartSpec, Filter, Aggregation} from '../data/types';
import {DataSource} from '../data/source';
import {formatNumber} from '../utils';
import {SelectionClipPaths} from './selection_clip_paths';
import {OpacitySelectionStrategy} from './selection/opacity_selection_strategy';

interface HeatmapCell extends Row {
  x: string;
  y: string;
  value: number;
}

export class HeatmapRenderer extends BaseRenderer {
  private clipPaths: SelectionClipPaths | null = null;

  constructor() {
    super();
    this.selectionStrategy = new OpacitySelectionStrategy();
  }

  async renderWithSource(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void> {
    if (spec.type !== 'heatmap') return;

    // Query data with filters and aggregation
    const aggregation: Aggregation = {
      fn: spec.aggregation,
      field: spec.value,
      groupBy: [spec.x, spec.y],
    };
    const data = await source.query(filters, aggregation);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'heatmap') return;

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

    // Aggregate data by x and y
    const aggregatedData = this.aggregateData(data, spec);

    if (aggregatedData.length === 0) {
      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .style('text-anchor', 'middle')
        .text('No data');
      return;
    }

    // Get unique x and y values
    const xValues = Array.from(new Set(aggregatedData.map((d) => d.x))).sort();
    const yValues = Array.from(new Set(aggregatedData.map((d) => d.y))).sort();

    // Scales
    const x = d3.scaleBand().domain(xValues).range([0, width]).padding(0.05);

    const y = d3.scaleBand().domain(yValues).range([0, height]).padding(0.05);

    const colorScale = d3
      .scaleSequential(d3.interpolateBlues)
      .domain([0, d3.max(aggregatedData, (d) => d.value) ?? 100]);

    // Setup brush with clip path highlighting
    this.setupHeatmapBrush(
      g,
      aggregatedData,
      data,
      spec,
      {x, y, colorScale},
      width,
      height,
    );

    // Draw heatmap cells
    this.drawHeatmap(g, aggregatedData, data, g, spec, x, y, colorScale);

    // Axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end');

    g.append('g').attr('class', 'y-axis').call(d3.axisLeft(y));

    // Axis labels
    g.append('text')
      .attr('transform', `translate(${width / 2},${height + 60})`)
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

    // Add color legend
    this.addColorLegend(g, colorScale, width, height, spec);
  }

  private aggregateData(
    data: Row[],
    spec: Extract<ChartSpec, {type: 'heatmap'}>,
  ): HeatmapCell[] {
    // Group by x and y
    const grouped = d3.group(
      data,
      (d) => String(d[spec.x]),
      (d) => String(d[spec.y]),
    );

    const result: HeatmapCell[] = [];

    grouped.forEach((yMap, xValue) => {
      yMap.forEach((cells, yValue) => {
        const values = cells
          .map((d) => Number(d[spec.value]))
          .filter((v) => !isNaN(v));

        if (values.length === 0) return;

        let aggregatedValue: number;
        switch (spec.aggregation) {
          case 'sum':
            aggregatedValue = d3.sum(values);
            break;
          case 'avg':
            aggregatedValue = d3.mean(values) ?? 0;
            break;
          case 'count':
            aggregatedValue = values.length;
            break;
          case 'min':
            aggregatedValue = d3.min(values) ?? 0;
            break;
          case 'max':
            aggregatedValue = d3.max(values) ?? 0;
            break;
          default:
            aggregatedValue = d3.sum(values);
        }

        result.push({
          x: xValue,
          y: yValue,
          value: aggregatedValue,
        });
      });
    });

    return result;
  }

  private drawHeatmap(
    container: d3.Selection<SVGGElement, unknown, null, undefined>,
    heatmapData: HeatmapCell[],
    data: Row[],
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    spec: Extract<ChartSpec, {type: 'heatmap'}>,
    x: d3.ScaleBand<string>,
    y: d3.ScaleBand<string>,
    colorScale: d3.ScaleSequential<string>,
    opacity: number = 1.0,
    enableTooltip: boolean = true,
  ) {
    const cells = container
      .selectAll('.heatmap-cell')
      .data(heatmapData)
      .enter()
      .append('rect')
      .attr('class', 'heatmap-cell selectable')
      .attr('x', (d) => x(d.x) ?? 0)
      .attr('y', (d) => y(d.y) ?? 0)
      .attr('width', x.bandwidth())
      .attr('height', y.bandwidth())
      .attr('fill', (d) => colorScale(d.value))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('opacity', opacity)
      .style('cursor', 'pointer')
      .style('pointer-events', 'all')
      .on('click', (_event, d) => {
        this.selectionStrategy.onSelection(
          [d],
          [
            {col: spec.x, op: '=', val: d.x},
            {col: spec.y, op: '=', val: d.y},
          ],
          {
            g,
            allData: data,
            onFilterRequest: this.onFilterRequest,
            updateSourceFilter: true,
          },
        );
      });

    // Only add tooltips to the main layer (not dimmed/highlight layers)
    if (enableTooltip) {
      this.setupTooltip(cells, (d: HeatmapCell) => {
        return `
          <strong>${spec.x}:</strong> ${d.x}<br>
          <strong>${spec.y}:</strong> ${d.y}<br>
          <strong>${spec.value}:</strong> ${formatNumber(d.value)}
        `;
      });
    }
  }

  private setupHeatmapBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    heatmapData: HeatmapCell[],
    data: Row[],
    spec: Extract<ChartSpec, {type: 'heatmap'}>,
    scales: {
      x: d3.ScaleBand<string>;
      y: d3.ScaleBand<string>;
      colorScale: d3.ScaleSequential<string>;
    },
    width: number,
    height: number,
  ) {
    const clearBrushVisuals = () => {
      g.selectAll('.heatmap-dimmed').remove();
      g.selectAll('.heatmap-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.heatmap-cell').style('opacity', 1);
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

        // Find selected x and y values
        const selectedX: string[] = [];
        const selectedY: string[] = [];

        scales.x.domain().forEach((xVal) => {
          const xPos = scales.x(xVal);
          const xWidth = scales.x.bandwidth();
          if (xPos !== undefined && x0 < xPos + xWidth && x1 > xPos) {
            selectedX.push(xVal);
          }
        });

        scales.y.domain().forEach((yVal) => {
          const yPos = scales.y(yVal);
          const yHeight = scales.y.bandwidth();
          if (yPos !== undefined && y0 < yPos + yHeight && y1 > yPos) {
            selectedY.push(yVal);
          }
        });

        // Remove previous layers
        g.selectAll('.heatmap-dimmed').remove();
        g.selectAll('.heatmap-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original cells
          g.selectAll('.heatmap-cell').style('opacity', 0);

          // Draw dimmed version (no tooltips)
          this.drawHeatmap(
            g.append('g').attr('class', 'heatmap-dimmed'),
            heatmapData,
            data,
            g,
            spec,
            scales.x,
            scales.y,
            scales.colorScale,
            0.2,
            false, // no tooltips on dimmed layer
          );

          // Create clip path for highlighted region
          if (this.clipPaths) {
            const clipUrl = this.clipPaths.createRectClip(
              x0,
              y0,
              x1 - x0,
              y1 - y0,
            );

            // Draw highlighted version with clip path (no tooltips)
            this.drawHeatmap(
              g
                .append('g')
                .attr('class', 'heatmap-highlight')
                .attr('clip-path', clipUrl),
              heatmapData,
              data,
              g,
              spec,
              scales.x,
              scales.y,
              scales.colorScale,
              1.0,
              false, // no tooltips on highlight layer
            );
          }
        } else {
          // Just dim slightly for FilterSelectionStrategy
          g.selectAll('.heatmap-cell').style('opacity', 0.7);
        }

        // Create filters
        const filters = [];
        if (
          selectedX.length > 0 &&
          selectedX.length < scales.x.domain().length
        ) {
          filters.push({col: spec.x, op: 'in' as const, val: selectedX});
        }
        if (
          selectedY.length > 0 &&
          selectedY.length < scales.y.domain().length
        ) {
          filters.push({col: spec.y, op: 'in' as const, val: selectedY});
        }

        // Use strategy pattern for selection handling
        if (this.selectionStrategy !== undefined) {
          const selectedCells = heatmapData.filter(
            (d) => selectedX.includes(d.x) && selectedY.includes(d.y),
          );
          this.selectionStrategy.onSelection(selectedCells, filters, {
            g,
            allData: data,
            onFilterRequest: this.onFilterRequest,
            updateSourceFilter: true,
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
            updateSourceFilter: true,
          });
        }
      }
    });
  }

  private addColorLegend(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    colorScale: d3.ScaleSequential<string>,
    width: number,
    _height: number,
    spec: Extract<ChartSpec, {type: 'heatmap'}>,
  ) {
    const legendWidth = 20;
    const legendHeight = 200;
    const legendX = width + 40;
    const legendY = 20;

    // Create gradient
    const defs = g.append('defs');
    const gradient = defs
      .append('linearGradient')
      .attr('id', 'heatmap-gradient')
      .attr('x1', '0%')
      .attr('y1', '100%')
      .attr('x2', '0%')
      .attr('y2', '0%');

    const numStops = 10;
    const domain = colorScale.domain();
    for (let i = 0; i <= numStops; i++) {
      const value = domain[0] + (i / numStops) * (domain[1] - domain[0]);
      gradient
        .append('stop')
        .attr('offset', `${(i / numStops) * 100}%`)
        .attr('stop-color', colorScale(value));
    }

    // Draw legend rectangle
    g.append('rect')
      .attr('x', legendX)
      .attr('y', legendY)
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', 'url(#heatmap-gradient)')
      .attr('stroke', '#ccc');

    // Add legend axis
    const legendScale = d3
      .scaleLinear()
      .domain(domain)
      .range([legendY + legendHeight, legendY]);

    g.append('g')
      .attr('transform', `translate(${legendX + legendWidth}, 0)`)
      .call(
        d3
          .axisRight(legendScale)
          .ticks(5)
          .tickFormat((d) => formatNumber(Number(d))),
      );

    // Legend label
    g.append('text')
      .attr('x', legendX + legendWidth / 2)
      .attr('y', legendY - 5)
      .style('text-anchor', 'middle')
      .style('font-size', '10px')
      .text(spec.value);
  }
}

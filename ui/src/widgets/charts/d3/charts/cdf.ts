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
import {SelectionClipPaths} from './selection_clip_paths';

export class CDFRenderer extends BaseRenderer {
  private clipPaths: SelectionClipPaths | null = null;

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
    if (spec.type !== 'cdf') return;

    // Query data with filters (no aggregation needed for CDF)
    const data = await source.query(filters);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'cdf') return;

    this.clear(svg);

    // Initialize SelectionClipPaths AFTER clearing to ensure defs element is fresh
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

    // Extract and sort values
    const values = data
      .map((d) => Number(d[spec.x]))
      .filter((v) => !isNaN(v))
      .sort(d3.ascending);

    if (values.length === 0) {
      // Create default scale for brush reset functionality
      const x = d3.scaleLinear().domain([0, 100]).range([0, width]);
      const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

      g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .style('text-anchor', 'middle')
        .text('No data');

      // Still render brush so user can reset filter
      this.setupEmptyBrush(g, spec, {x, y}, width, height);
      return;
    }

    if (spec.colorBy) {
      this.renderColoredCDF(g, data, spec, width, height);
    } else {
      this.renderSingleCDF(g, values, spec, width, height);
    }
  }

  private renderSingleCDF(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    values: number[],
    spec: Extract<ChartSpec, {type: 'cdf'}>,
    width: number,
    height: number,
  ) {
    // Create CDF points
    const cdfPoints = values.map((value, i) => ({
      x: value,
      y: (i + 1) / values.length,
    }));

    // Scales
    const x = d3
      .scaleLinear()
      .domain(d3.extent(values) as [number, number])
      .range([0, width]);

    const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    // Add grid lines first (so they appear behind data)
    this.addGridLines(g, x, y, width, height);

    // Line generator
    const line = d3
      .line<{x: number; y: number}>()
      .x((d) => x(d.x))
      .y((d) => y(d.y));

    // Add custom brush with clip path highlighting
    this.setupCDFBrush(g, cdfPoints, spec, {x, y}, width, height, line);

    // Create crosshair elements (hidden by default)
    const crosshairGroup = g
      .append('g')
      .attr('class', 'crosshair')
      .style('display', 'none')
      .style('pointer-events', 'none');

    crosshairGroup
      .append('line')
      .attr('class', 'crosshair-vertical')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    const horizontalLine = crosshairGroup
      .append('line')
      .attr('class', 'crosshair-horizontal')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('stroke', '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    crosshairGroup
      .append('circle')
      .attr('class', 'crosshair-dot')
      .attr('r', 4)
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 2);

    // Invisible thick line for mouse events
    const cdfPath = g
      .append('path')
      .datum(cdfPoints)
      .attr('class', 'cdf-line-hover')
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', '10px')
      .attr('d', line)
      .style('pointer-events', 'stroke')
      .style('cursor', 'crosshair');

    // Visible CDF line on top
    g.append('path')
      .datum(cdfPoints)
      .attr('class', 'cdf-line')
      .attr('fill', 'none')
      .attr('stroke', 'steelblue')
      .attr('stroke-width', 2)
      .attr('d', line)
      .style('pointer-events', 'none');

    // Create tooltip
    const tooltip = d3
      .select('body')
      .selectAll<HTMLDivElement, null>('.chart-tooltip')
      .data([null])
      .join('div')
      .attr('class', 'chart-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background', 'rgba(0, 0, 0, 0.8)')
      .style('color', 'white')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000');

    // Setup tooltip and crosshairs on the invisible thick line
    cdfPath
      .on('mouseover', () => {
        tooltip.style('visibility', 'visible');
        crosshairGroup.style('display', null);
      })
      .on('mousemove', (event: MouseEvent) => {
        const [mouseX] = d3.pointer(event);
        const xValue = x.invert(mouseX);

        // Find the CDF value at this x (interpolate between points)
        let cdfValue = 0;
        let interpolatedX = xValue;
        for (let i = 0; i < cdfPoints.length; i++) {
          if (cdfPoints[i].x >= xValue) {
            if (i === 0) {
              cdfValue = cdfPoints[0].y;
              interpolatedX = cdfPoints[0].x;
            } else {
              // Linear interpolation
              const p0 = cdfPoints[i - 1];
              const p1 = cdfPoints[i];
              const t = (xValue - p0.x) / (p1.x - p0.x);
              cdfValue = p0.y + t * (p1.y - p0.y);
            }
            break;
          }
        }
        if (cdfValue === 0 && cdfPoints.length > 0) {
          cdfValue = cdfPoints[cdfPoints.length - 1].y;
          interpolatedX = cdfPoints[cdfPoints.length - 1].x;
        }

        const dotX = x(interpolatedX);
        const dotY = y(cdfValue);

        // Update crosshairs - both at data point
        crosshairGroup
          .select('.crosshair-vertical')
          .attr('x1', dotX)
          .attr('x2', dotX);
        horizontalLine.attr('y1', dotY).attr('y2', dotY);
        crosshairGroup
          .select('.crosshair-dot')
          .attr('cx', dotX)
          .attr('cy', dotY);

        tooltip
          .html(
            `<strong>${spec.x}:</strong> ${formatNumber(xValue)}<br/><strong>CDF:</strong> ${(cdfValue * 100).toFixed(1)}%`,
          )
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`);
      })
      .on('mouseout', () => {
        tooltip.style('visibility', 'hidden');
        crosshairGroup.style('display', 'none');
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
          .ticks(5)
          .tickFormat((d) => `${(Number(d) * 100).toFixed(0)}%`),
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
      .text('Cumulative Probability');
  }

  private renderColoredCDF(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'cdf'}>,
    width: number,
    height: number,
  ) {
    // Group by color
    const grouped = d3.group(data, (d) => d[spec.colorBy!]);
    const categories = Array.from(grouped.keys()).filter(
      (k): k is string | number | boolean => k !== null && k !== undefined,
    );

    // Color scale
    const colorScale = d3
      .scaleOrdinal<string>()
      .domain(categories.map(String))
      .range(d3.schemeCategory10);

    // Get global extent for x scale
    const allValues = data
      .map((d) => Number(d[spec.x]))
      .filter((v) => !isNaN(v));
    const xExtent = d3.extent(allValues) as [number, number];

    // Scales
    const x = d3.scaleLinear().domain(xExtent).range([0, width]);

    const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    // Add grid lines first (so they appear behind data)
    this.addGridLines(g, x, y, width, height);

    // Line generator
    const line = d3
      .line<{x: number; y: number}>()
      .x((d) => x(d.x))
      .y((d) => y(d.y));

    // Store CDF points for each category for tooltip
    const cdfPointsByCategory = new Map<
      string,
      Array<{x: number; y: number}>
    >();

    // Compute CDF points for each category
    grouped.forEach((groupData, category) => {
      const values = groupData
        .map((d) => Number(d[spec.x]))
        .filter((v) => !isNaN(v))
        .sort(d3.ascending);

      const cdfPoints = values.map((value, i) => ({
        x: value,
        y: (i + 1) / values.length,
      }));

      cdfPointsByCategory.set(String(category), cdfPoints);
    });

    // Add custom brush with clip path highlighting
    this.setupColoredCDFBrush(
      g,
      data,
      spec,
      {x, y},
      width,
      height,
      line,
      colorScale,
    );

    // Create crosshair elements (hidden by default)
    const crosshairGroup = g
      .append('g')
      .attr('class', 'crosshair')
      .style('display', 'none')
      .style('pointer-events', 'none');

    crosshairGroup
      .append('line')
      .attr('class', 'crosshair-vertical')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    const horizontalLinesGroup = crosshairGroup
      .append('g')
      .attr('class', 'crosshair-horizontals');

    const dotsGroup = crosshairGroup
      .append('g')
      .attr('class', 'crosshair-dots');

    // Create tooltip
    const tooltip = d3
      .select('body')
      .selectAll<HTMLDivElement, null>('.chart-tooltip')
      .data([null])
      .join('div')
      .attr('class', 'chart-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background', 'rgba(0, 0, 0, 0.8)')
      .style('color', 'white')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000');

    // Draw lines for each category with tooltips
    cdfPointsByCategory.forEach((cdfPoints, category) => {
      // Invisible thick line for mouse events
      const cdfPath = g
        .append('path')
        .datum(cdfPoints)
        .attr('class', 'cdf-line-hover')
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', '10px')
        .attr('d', line)
        .style('pointer-events', 'stroke')
        .style('cursor', 'crosshair');

      // Visible CDF line on top
      g.append('path')
        .datum(cdfPoints)
        .attr('class', 'cdf-line')
        .attr('fill', 'none')
        .attr('stroke', colorScale(category))
        .attr('stroke-width', 2)
        .attr('d', line)
        .style('pointer-events', 'none')
        .style('cursor', 'pointer')
        .on('click', () => {
          if (category !== null && category !== undefined) {
            this.onFilterRequest?.(spec.colorBy!, '=', category);
          }
        });

      // Setup tooltip and crosshairs showing all series at this x position
      cdfPath
        .on('mouseover', () => {
          tooltip.style('visibility', 'visible');
          crosshairGroup.style('display', null);
        })
        .on('mousemove', (event: MouseEvent) => {
          const [mouseX] = d3.pointer(event);
          const xValue = x.invert(mouseX);

          // Get CDF values for all categories at this x
          const valuesAtX: Array<{
            category: string;
            cdf: number;
            interpolatedX: number;
          }> = [];

          cdfPointsByCategory.forEach((points, cat) => {
            let cdfValue = 0;
            let interpolatedX = xValue;
            for (let i = 0; i < points.length; i++) {
              if (points[i].x >= xValue) {
                if (i === 0) {
                  cdfValue = points[0].y;
                  interpolatedX = points[0].x;
                } else {
                  // Linear interpolation
                  const p0 = points[i - 1];
                  const p1 = points[i];
                  const t = (xValue - p0.x) / (p1.x - p0.x);
                  cdfValue = p0.y + t * (p1.y - p0.y);
                }
                break;
              }
            }
            if (cdfValue === 0 && points.length > 0) {
              cdfValue = points[points.length - 1].y;
              interpolatedX = points[points.length - 1].x;
            }

            valuesAtX.push({category: cat, cdf: cdfValue, interpolatedX});
          });

          if (valuesAtX.length === 0) return;

          // Update vertical crosshair at data point
          const crosshairX = x(xValue);
          crosshairGroup
            .select('.crosshair-vertical')
            .attr('x1', crosshairX)
            .attr('x2', crosshairX);

          // Update horizontal lines for each series
          const horizontalLineData = valuesAtX.map(({category: cat, cdf}) => ({
            y: y(cdf),
            color: colorScale(cat),
          }));

          horizontalLinesGroup
            .selectAll<SVGLineElement, {y: number; color: string}>('line')
            .data(horizontalLineData)
            .join('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', (d) => d.y)
            .attr('y2', (d) => d.y)
            .attr('stroke', (d) => d.color)
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,4')
            .attr('opacity', 0.7);

          // Update dots for all series
          const dotData = valuesAtX.map(({category: cat, cdf}) => ({
            x: x(xValue),
            y: y(cdf),
            color: colorScale(cat),
          }));

          dotsGroup
            .selectAll<SVGCircleElement, {x: number; y: number; color: string}>(
              'circle',
            )
            .data(dotData)
            .join('circle')
            .attr('cx', (d) => d.x)
            .attr('cy', (d) => d.y)
            .attr('r', 4)
            .attr('fill', (d) => d.color)
            .attr('stroke', 'white')
            .attr('stroke-width', 2);

          // Build tooltip HTML
          let html = `<strong>${spec.x}:</strong> ${formatNumber(xValue)}<br/>`;
          valuesAtX.forEach(({category: cat, cdf}) => {
            const color = colorScale(cat);
            html += `<span style="color: ${color}">●</span> <strong>${cat}:</strong> ${(cdf * 100).toFixed(1)}%<br/>`;
          });

          tooltip
            .html(html)
            .style('left', `${event.pageX + 10}px`)
            .style('top', `${event.pageY - 10}px`);
        })
        .on('mouseout', () => {
          tooltip.style('visibility', 'hidden');
          crosshairGroup.style('display', 'none');
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
          .ticks(5)
          .tickFormat((d) => `${(Number(d) * 100).toFixed(0)}%`),
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
      .text('Cumulative Probability');

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
          if (category !== null && category !== undefined) {
            this.onFilterRequest?.(spec.colorBy!, '=', category);
          }
        });

      legendRow
        .append('rect')
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', colorScale(String(category)));

      legendRow
        .append('text')
        .attr('x', 15)
        .attr('y', 9)
        .style('font-size', '11px')
        .text(String(category));
    });
  }

  /**
   * Custom brush setup for single CDF with clip path highlighting
   */
  private setupCDFBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    cdfPoints: Array<{x: number; y: number}>,
    spec: Extract<ChartSpec, {type: 'cdf'}>,
    scales: {
      x: d3.ScaleLinear<number, number>;
      y: d3.ScaleLinear<number, number>;
    },
    width: number,
    height: number,
    line: d3.Line<{x: number; y: number}>,
  ) {
    const clearBrushVisuals = () => {
      g.selectAll('.cdf-dimmed').remove();
      g.selectAll('.cdf-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.cdf-line').style('opacity', 1);
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
          // Use strategy pattern for clearing
          if (this.selectionStrategy !== undefined) {
            this.selectionStrategy.onClear({
              g,
              allData: [],
              onFilterRequest: this.onFilterRequest,
            });
          }
          return;
        }

        const [x0, x1] = event.selection as [number, number];
        const minValue = scales.x.invert(x0);
        const maxValue = scales.x.invert(x1);

        // Remove previous dimmed/highlight layers
        g.selectAll('.cdf-dimmed').remove();
        g.selectAll('.cdf-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths (OpacitySelectionStrategy) or not (FilterSelectionStrategy)
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original line
          g.selectAll('.cdf-line').style('opacity', 0);

          // Draw dimmed version
          g.append('path')
            .datum(cdfPoints)
            .attr('class', 'cdf-dimmed')
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
              .datum(cdfPoints)
              .attr('class', 'cdf-highlight')
              .attr('fill', 'none')
              .attr('stroke', 'steelblue')
              .attr('stroke-width', 2)
              .attr('d', line)
              .attr('clip-path', clipUrl);
          }
        } else {
          // Just dim the line slightly for FilterSelectionStrategy
          g.selectAll('.cdf-line').style('opacity', 0.7);
        }

        // Use strategy pattern for selection handling
        if (this.selectionStrategy !== undefined) {
          // For CDF, we need to create two filters (>= and <=)
          // The strategy will handle whether to actually create filters or just visual
          this.selectionStrategy.onSelection(
            [], // selectedData not needed for CDF
            [
              {col: spec.x, op: '>=', val: minValue},
              {col: spec.x, op: '<=', val: maxValue},
            ],
            {
              g,
              allData: [],
              onFilterRequest: this.onFilterRequest,
            },
          );
        }
      });

    const brushGroup = g.append('g').attr('class', 'brush').call(brush);

    // Add click-to-clear: click on chart background clears brush
    g.on('click', (event: MouseEvent) => {
      // Only clear if clicking on background (not on brush handles or selection)
      if (
        event.target === event.currentTarget ||
        d3.select(event.target as Element).classed('overlay')
      ) {
        brush.clear(
          brushGroup as d3.Selection<SVGGElement, unknown, null, undefined>,
        );
        clearBrushVisuals();
        // Use strategy pattern for clearing
        if (this.selectionStrategy !== undefined) {
          this.selectionStrategy.onClear({
            g,
            allData: [],
            onFilterRequest: this.onFilterRequest,
          });
        }
      }
    });
  }

  /**
   * Custom brush setup for colored CDF with clip path highlighting
   */
  private setupColoredCDFBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'cdf'}>,
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
    const grouped = d3.group(data, (d) => d[spec.colorBy!]);

    const clearBrushVisuals = () => {
      g.selectAll('.cdf-dimmed').remove();
      g.selectAll('.cdf-highlight').remove();
      if (this.clipPaths) {
        this.clipPaths.removeAllClips();
      }
      g.selectAll('.cdf-line').style('opacity', 1);
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
          // Use strategy pattern for clearing
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
        g.selectAll('.cdf-dimmed').remove();
        g.selectAll('.cdf-highlight').remove();
        if (this.clipPaths) {
          this.clipPaths.removeAllClips();
        }

        // Check if we should use clip paths (OpacitySelectionStrategy) or not (FilterSelectionStrategy)
        const useClipPaths =
          this.selectionStrategy?.constructor.name ===
          'OpacitySelectionStrategy';

        if (useClipPaths) {
          // Hide original lines
          g.selectAll('.cdf-line').style('opacity', 0);

          // Draw dimmed versions for each group
          grouped.forEach((groupData, category) => {
            const values = groupData
              .map((d) => Number(d[spec.x]))
              .filter((v) => !isNaN(v))
              .sort(d3.ascending);

            const cdfPoints = values.map((value, i) => ({
              x: value,
              y: (i + 1) / values.length,
            }));

            g.append('path')
              .datum(cdfPoints)
              .attr('class', 'cdf-dimmed')
              .attr('fill', 'none')
              .attr('stroke', colorScale(String(category)))
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
            grouped.forEach((groupData, category) => {
              const values = groupData
                .map((d) => Number(d[spec.x]))
                .filter((v) => !isNaN(v))
                .sort(d3.ascending);

              const cdfPoints = values.map((value, i) => ({
                x: value,
                y: (i + 1) / values.length,
              }));

              g.append('path')
                .datum(cdfPoints)
                .attr('class', 'cdf-highlight')
                .attr('fill', 'none')
                .attr('stroke', colorScale(String(category)))
                .attr('stroke-width', 2)
                .attr('d', line)
                .attr('clip-path', clipUrl);
            });
          }
        } else {
          // Just dim the lines slightly for FilterSelectionStrategy
          g.selectAll('.cdf-line').style('opacity', 0.7);
        }

        // Use strategy pattern for selection handling
        if (this.selectionStrategy !== undefined) {
          // For CDF, we need to create two filters (>= and <=)
          // The strategy will handle whether to actually create filters or just visual
          this.selectionStrategy.onSelection(
            [], // selectedData not needed for CDF
            [
              {col: spec.x, op: '>=', val: minValue},
              {col: spec.x, op: '<=', val: maxValue},
            ],
            {
              g,
              allData: data,
              onFilterRequest: this.onFilterRequest,
            },
          );
        }
      });

    const brushGroup = g.append('g').attr('class', 'brush').call(brush);

    // Add click-to-clear: click on chart background clears brush
    g.on('click', (event: MouseEvent) => {
      // Only clear if clicking on background (not on brush handles or selection)
      if (
        event.target === event.currentTarget ||
        d3.select(event.target as Element).classed('overlay')
      ) {
        brush.clear(
          brushGroup as d3.Selection<SVGGElement, unknown, null, undefined>,
        );
        clearBrushVisuals();
        // Use strategy pattern for clearing
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

  /**
   * Setup brush for empty data case - allows clearing filters
   */
  private setupEmptyBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    _spec: Extract<ChartSpec, {type: 'cdf'}>,
    _scales: {
      x: d3.ScaleLinear<number, number>;
      y: d3.ScaleLinear<number, number>;
    },
    width: number,
    height: number,
  ) {
    const brush = d3
      .brushX()
      .extent([
        [0, 0],
        [width, height],
      ])
      .on('end', (event: d3.D3BrushEvent<unknown>) => {
        if (event.selection === null) {
          // Use strategy pattern for clearing
          if (this.selectionStrategy !== undefined) {
            this.selectionStrategy.onClear({
              g,
              allData: [],
              onFilterRequest: this.onFilterRequest,
            });
          }
        }
      });

    g.append('g').attr('class', 'brush').call(brush);
  }
}

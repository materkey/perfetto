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
import {Row, ChartSpec, Filter} from '../data/types';
import {DataSource} from '../data/source';
import {BrushBehavior, BrushScales} from './brushing';
import {SelectionStrategy, FilterSelectionStrategy} from './selection';

export interface ChartRenderer {
  onFilterRequest?: (
    col: string,
    op: Filter['op'],
    val: string | number | boolean | string[] | number[] | null,
  ) => void;
  render(svg: SVGElement, data: Row[], spec: ChartSpec): void;
  renderWithSource?(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void>;
  destroy?(svg: SVGElement): void;
}

export abstract class BaseRenderer implements ChartRenderer {
  protected margin = {top: 20, right: 20, bottom: 40, left: 50};
  protected brushBehavior?: BrushBehavior;
  protected selectionStrategy: SelectionStrategy =
    new FilterSelectionStrategy();

  onFilterRequest?: (
    col: string,
    op: Filter['op'],
    val: string | number | boolean | string[] | number[] | null,
  ) => void;

  /**
   * Set the selection strategy (filter vs opacity-only)
   */
  setSelectionStrategy(strategy: SelectionStrategy): void {
    this.selectionStrategy = strategy;
  }

  abstract render(svg: SVGElement, data: Row[], spec: ChartSpec): void;

  protected clear(svg: SVGElement) {
    d3.select(svg).selectAll('*').remove();
  }

  protected getDimensions(svg: SVGElement) {
    const width = svg.clientWidth - this.margin.left - this.margin.right;
    const height = svg.clientHeight - this.margin.top - this.margin.bottom;
    return {width, height};
  }

  protected createGroup(svg: SVGElement) {
    return d3
      .select(svg)
      .append('g')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
  }

  protected setupTooltip<
    GElement extends d3.BaseType,
    Datum,
    PElement extends d3.BaseType,
    PDatum,
  >(
    selection: d3.Selection<GElement, Datum, PElement, PDatum>,
    contentFn: (d: Datum) => string,
  ) {
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

    selection
      .on('mouseover', (_event: MouseEvent, d: Datum) => {
        tooltip.style('visibility', 'visible').html(contentFn(d));
      })
      .on('mousemove', (event: MouseEvent) => {
        tooltip
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`);
      })
      .on('mouseout', () => {
        tooltip.style('visibility', 'hidden');
      });
  }

  /**
   * Add grid lines to the chart for better readability.
   * Grid lines are rendered behind the data.
   * @param g - The SVG group element to add grid lines to
   * @param xScale - The x-axis scale
   * @param yScale - The y-axis scale
   * @param width - The chart width
   * @param height - The chart height
   * @param showVertical - Whether to show vertical grid lines (default: true)
   */
  protected addGridLines(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    xScale: d3.AxisScale<d3.NumberValue> | d3.AxisScale<string>,
    yScale: d3.AxisScale<d3.NumberValue>,
    width: number,
    height: number,
    showVertical: boolean = true,
  ) {
    // Add horizontal grid lines (for y-axis)
    g.append('g')
      .attr('class', 'grid grid-horizontal')
      .style('pointer-events', 'none')
      .call(
        d3
          .axisLeft(yScale)
          .tickSize(-width)
          .tickFormat(() => ''),
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g
          .selectAll('.tick line')
          .attr('stroke', '#e0e0e0')
          .attr('stroke-opacity', 0.7)
          .attr('stroke-dasharray', '2,2'),
      );

    // Add vertical grid lines (for x-axis) only if it's a continuous scale and showVertical is true
    if (showVertical && 'ticks' in xScale) {
      g.append('g')
        .attr('class', 'grid grid-vertical')
        .attr('transform', `translate(0,${height})`)
        .style('pointer-events', 'none')
        .call(
          d3
            .axisBottom(xScale as d3.AxisScale<d3.NumberValue>)
            .tickSize(-height)
            .tickFormat(() => ''),
        )
        .call((g) => g.select('.domain').remove())
        .call((g) =>
          g
            .selectAll('.tick line')
            .attr('stroke', '#e0e0e0')
            .attr('stroke-opacity', 0.7)
            .attr('stroke-dasharray', '2,2'),
        );
    }
  }

  /**
   * Add crosshairs that follow the mouse cursor with tooltip showing values.
   * This creates the visual elements (lines and dots) but returns handlers for the overlay.
   * The overlay should be added AFTER the brush to ensure both work together.
   * @param g - The SVG group element
   * @param width - The chart width
   * @param height - The chart height
   * @param getTooltipContent - Function to generate tooltip HTML based on mouse position
   * @param getDotPositions - Optional function to get positions and colors for dots on the lines
   * @returns Object with methods to attach the overlay later
   */
  protected addCrosshairs(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    width: number,
    height: number,
    getTooltipContent: (mouseX: number, mouseY: number) => string | null,
    getDotPositions?: (
      mouseX: number,
      mouseY: number,
    ) => Array<{x: number; y: number; color: string}>,
  ): {attachOverlay: () => void} {
    // Create crosshair group (visual elements only, no overlay yet)
    const crosshairGroup = g
      .append('g')
      .attr('class', 'crosshair')
      .style('display', 'none')
      .style('pointer-events', 'none');

    // Vertical line
    crosshairGroup
      .append('line')
      .attr('class', 'crosshair-vertical')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    // Horizontal line
    crosshairGroup
      .append('line')
      .attr('class', 'crosshair-horizontal')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('stroke', '#666')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    // Group for dots on the lines
    const dotsGroup = crosshairGroup
      .append('g')
      .attr('class', 'crosshair-dots');

    // Create tooltip
    const tooltip = d3
      .select('body')
      .selectAll<HTMLDivElement, null>('.chart-crosshair-tooltip')
      .data([null])
      .join('div')
      .attr('class', 'chart-crosshair-tooltip')
      .style('position', 'absolute')
      .style('visibility', 'hidden')
      .style('background', 'rgba(0, 0, 0, 0.9)')
      .style('color', 'white')
      .style('padding', '8px 12px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000')
      .style('white-space', 'nowrap');

    // Return a function to attach the overlay later (after brush is added)
    return {
      attachOverlay: () => {
        // Create invisible overlay for mouse tracking - added AFTER brush
        const overlay = g
          .append('rect')
          .attr('class', 'crosshair-overlay')
          .attr('width', width)
          .attr('height', height)
          .style('fill', 'none')
          .style('pointer-events', 'all');

        overlay
          .on('mousemove', (event: MouseEvent) => {
            const [mouseX, mouseY] = d3.pointer(event);

            // Show crosshairs
            crosshairGroup.style('display', null);
            crosshairGroup
              .select('.crosshair-vertical')
              .attr('x1', mouseX)
              .attr('x2', mouseX);
            crosshairGroup
              .select('.crosshair-horizontal')
              .attr('y1', mouseY)
              .attr('y2', mouseY);

            // Update dots if getDotPositions is provided
            if (getDotPositions) {
              const dotPositions = getDotPositions(mouseX, mouseY);
              dotsGroup
                .selectAll<
                  SVGCircleElement,
                  {x: number; y: number; color: string}
                >('circle')
                .data(dotPositions)
                .join('circle')
                .attr('cx', (d) => d.x)
                .attr('cy', (d) => d.y)
                .attr('r', 4)
                .attr('fill', (d) => d.color)
                .attr('stroke', 'white')
                .attr('stroke-width', 2);
            }

            // Get tooltip content
            const content = getTooltipContent(mouseX, mouseY);
            if (content) {
              tooltip
                .style('visibility', 'visible')
                .html(content)
                .style('left', `${event.pageX + 15}px`)
                .style('top', `${event.pageY - 10}px`);
            } else {
              tooltip.style('visibility', 'hidden');
            }
          })
          .on('mouseout', () => {
            crosshairGroup.style('display', 'none');
            tooltip.style('visibility', 'hidden');
          });
      },
    };
  }

  protected setupBrush(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: ChartSpec,
    scales: BrushScales,
    width: number,
    height: number,
  ) {
    if (!this.brushBehavior) return;

    const brush = this.brushBehavior.createBrush(width, height);

    brush.on('end', (event: d3.D3BrushEvent<unknown>) => {
      if (event.selection === null) {
        // Delegate to strategy for clearing
        this.selectionStrategy.onClear({
          g,
          allData: data,
          onFilterRequest: this.onFilterRequest,
        });
        return;
      }

      const result = this.brushBehavior!.onBrushEnd(
        {
          type: Array.isArray(event.selection[0]) ? '2d' : '1d',
          extent: event.selection,
        },
        data,
        spec,
        scales,
      );

      // Delegate to strategy for handling selection
      // Strategy decides whether to apply filters, opacity, or both
      this.selectionStrategy.onSelection(result.selectedData, result.filters, {
        g,
        allData: data,
        onFilterRequest: this.onFilterRequest,
      });
    });

    g.append('g')
      .attr('class', 'brush')
      .call(brush as d3.BrushBehavior<unknown>);
  }

  destroy(svg: SVGElement) {
    this.clear(svg);
  }
}

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
import {CategoricalBrush} from './brushing';

export class BarChartRenderer extends BaseRenderer {
  constructor() {
    super();
    this.brushBehavior = new CategoricalBrush();
  }

  async renderWithSource(
    svg: SVGElement,
    source: DataSource,
    filters: Filter[],
    spec: ChartSpec,
  ): Promise<void> {
    if (spec.type !== 'bar') return;

    // Query data with filters and aggregation
    const aggregation = this.getAggregation(spec);
    const data = await source.query(filters, aggregation);

    // Delegate to existing render logic
    this.render(svg, data, spec);
  }

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'bar') return;

    this.clear(svg);
    const {width, height} = this.getDimensions(svg);
    const g = this.createGroup(svg);

    // Check if we have groupBy for multi-series charts
    if (spec.groupBy) {
      const mode = spec.mode ?? 'grouped';
      if (mode === 'stacked') {
        this.renderStacked(
          svg,
          g,
          data,
          spec as Extract<ChartSpec, {type: 'bar'}> & {groupBy: string},
          width,
          height,
        );
      } else {
        this.renderGrouped(
          svg,
          g,
          data,
          spec as Extract<ChartSpec, {type: 'bar'}> & {groupBy: string},
          width,
          height,
        );
      }
    } else {
      this.renderSimple(svg, g, data, spec, width, height);
    }
  }

  private getAggregation(spec: ChartSpec): Aggregation | undefined {
    if (spec.type !== 'bar') return undefined;

    const groupBy = [spec.x];
    if (spec.groupBy) {
      groupBy.push(spec.groupBy);
    }
    return {
      fn: spec.aggregation,
      field: spec.y,
      groupBy,
    };
  }

  private renderSimple(
    _svg: SVGElement,
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'bar'}>,
    width: number,
    height: number,
  ) {
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

  private renderGrouped(
    _svg: SVGElement,
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'bar'}> & {groupBy: string},
    width: number,
    height: number,
  ) {
    // Get unique categories and groups
    const categories = Array.from(new Set(data.map((d) => String(d[spec.x]))));
    const groups = Array.from(
      new Set(data.map((d) => String(d[spec.groupBy]))),
    );

    // Color scale for groups
    const colorScale = d3
      .scaleOrdinal<string>()
      .domain(groups)
      .range(d3.schemeCategory10);

    // X scale for categories
    const x0 = d3.scaleBand().domain(categories).range([0, width]).padding(0.1);

    // X scale for groups within categories
    const x1 = d3
      .scaleBand()
      .domain(groups)
      .range([0, x0.bandwidth()])
      .padding(0.05);

    // Y scale
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => Number(d[spec.y])) ?? 0])
      .nice()
      .range([height, 0]);

    // Add grid lines first
    this.addGridLines(g, x0, y, width, height);

    // Add brush
    this.setupBrush(g, data, spec, {x: x0, y}, width, height);

    // Group data by category
    const groupedData = d3.group(data, (d) => String(d[spec.x]));

    // Draw bars
    const categoryGroups = g
      .selectAll<SVGGElement, [string, Row[]]>('.category-group')
      .data(Array.from(groupedData))
      .join('g')
      .attr('class', 'category-group')
      .attr('transform', ([category]) => `translate(${x0(category)},0)`);

    const bars = categoryGroups
      .selectAll<SVGRectElement, Row>('.bar')
      .data(([, rows]) => rows)
      .join('rect')
      .attr('class', 'bar selectable')
      .attr('x', (d) => x1(String(d[spec.groupBy]))!)
      .attr('y', (d) => y(Number(d[spec.y])))
      .attr('width', x1.bandwidth())
      .attr('height', (d) => height - y(Number(d[spec.y])))
      .attr('fill', (d) => colorScale(String(d[spec.groupBy])))
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        const value = d[spec.groupBy];
        if (value !== undefined && value !== null) {
          this.onFilterRequest?.(spec.groupBy, '=', value);
        }
      });

    // Tooltips
    this.setupTooltip(bars, (d) => {
      return `<strong>${d[spec.x]}</strong><br/><strong>${spec.groupBy}:</strong> ${d[spec.groupBy]}<br/>${spec.y}: ${formatNumber(Number(d[spec.y]))}`;
    });

    // Axes
    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x0))
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

    // Legend
    this.addLegend(g, groups, colorScale, width);
  }

  private renderStacked(
    _svg: SVGElement,
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    data: Row[],
    spec: Extract<ChartSpec, {type: 'bar'}> & {groupBy: string},
    width: number,
    height: number,
  ) {
    // Get unique categories and groups
    const categories = Array.from(new Set(data.map((d) => String(d[spec.x]))));
    const groups = Array.from(
      new Set(data.map((d) => String(d[spec.groupBy]))),
    );

    // Color scale for groups
    const colorScale = d3
      .scaleOrdinal<string>()
      .domain(groups)
      .range(d3.schemeCategory10);

    // Pivot data: transform flat rows into objects with all groups
    const pivotedData = categories.map((category) => {
      const categoryData: Record<string, string | number> = {category};
      const categoryRows = data.filter((d) => String(d[spec.x]) === category);

      // Initialize all groups to 0
      groups.forEach((group) => {
        categoryData[group] = 0;
      });

      // Fill in actual values
      categoryRows.forEach((row) => {
        const group = String(row[spec.groupBy]);
        categoryData[group] = Number(row[spec.y]) || 0;
      });

      return categoryData;
    });

    // Stack the data
    const stack = d3
      .stack<Record<string, string | number>>()
      .keys(groups)
      .value((d, key) => Number(d[key]) || 0);

    const series = stack(pivotedData);

    // X scale
    const x = d3.scaleBand().domain(categories).range([0, width]).padding(0.1);

    // Y scale - domain is max of stacked values
    const maxY = d3.max(series, (s) => d3.max(s, (d) => d[1])) ?? 0;
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([height, 0]);

    // Add grid lines first
    this.addGridLines(g, x, y, width, height);

    // Add brush
    this.setupBrush(g, data, spec, {x, y}, width, height);

    // Draw stacked bars
    const layers = g
      .selectAll<
        SVGGElement,
        d3.Series<Record<string, string | number>, string>
      >('.layer')
      .data(series)
      .join('g')
      .attr('class', 'layer')
      .attr('fill', (d) => colorScale(d.key));

    // Create a map to find original data rows by category and group
    const dataMap = new Map<string, Row>();
    data.forEach((row) => {
      const key = `${row[spec.x]}_${row[spec.groupBy]}`;
      dataMap.set(key, row);
    });

    type ExtendedSeriesPoint = d3.SeriesPoint<
      Record<string, string | number>
    > & {
      groupKey: string;
    };

    interface TooltipInfo {
      category: string;
      group: string;
      value: number;
    }

    interface ExtendedElement extends SVGRectElement {
      __tooltipInfo__?: TooltipInfo;
      __data__?: Row;
    }

    layers
      .selectAll<
        SVGRectElement,
        d3.SeriesPoint<Record<string, string | number>>
      >('.bar')
      .data((d) => {
        // Attach the group key to each data point for later reference
        return d.map((point) => ({
          ...point,
          groupKey: d.key,
        })) as ExtendedSeriesPoint[];
      })
      .join('rect')
      .attr('class', 'bar selectable')
      .attr('x', (d) => {
        const extended = d as ExtendedSeriesPoint;
        return x(String(extended.data.category))!;
      })
      .attr('y', (d) => {
        const extended = d as ExtendedSeriesPoint;
        return y(extended[1]);
      })
      .attr('height', (d) => {
        const extended = d as ExtendedSeriesPoint;
        return y(extended[0]) - y(extended[1]);
      })
      .attr('width', x.bandwidth())
      .style('cursor', 'pointer')
      .each((d, i, nodes) => {
        const extended = d as ExtendedSeriesPoint;
        // Store tooltip info and original data row reference
        const category = String(extended.data.category);
        const group = extended.groupKey;
        const value = extended[1] - extended[0];

        const element = nodes[i] as ExtendedElement;
        // Store for tooltip
        element.__tooltipInfo__ = {category, group, value};

        // Store reference to original data row for opacity selection
        const originalRow = dataMap.get(`${category}_${group}`);
        if (originalRow !== undefined) {
          element.__data__ = originalRow;
        }
      })
      .on('click', (_event) => {
        // Get the group name from the parent layer
        const layer = d3.select(
          (_event.target as Element).parentNode as SVGGElement,
        );
        const groupName = layer.datum() as d3.Series<
          Record<string, string | number>,
          string
        >;
        this.onFilterRequest?.(spec.groupBy, '=', groupName.key);
      })
      .on('mouseover', (event: MouseEvent) => {
        const element = event.currentTarget as ExtendedElement;
        const tooltipInfo = element.__tooltipInfo__;
        if (tooltipInfo === undefined) return;

        const tooltip = d3
          .select('body')
          .selectAll<HTMLDivElement, null>('.chart-tooltip')
          .data([null])
          .join('div')
          .attr('class', 'chart-tooltip')
          .style('position', 'absolute')
          .style('visibility', 'visible')
          .style('background', 'rgba(0, 0, 0, 0.8)')
          .style('color', 'white')
          .style('padding', '8px')
          .style('border-radius', '4px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .html(
            `<strong>${tooltipInfo.category}</strong><br/><strong>${spec.groupBy}:</strong> ${tooltipInfo.group}<br/>${spec.y}: ${formatNumber(tooltipInfo.value)}`,
          );

        tooltip
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`);
      })
      .on('mousemove', (event: MouseEvent) => {
        d3.select('.chart-tooltip')
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`);
      })
      .on('mouseout', () => {
        d3.select('.chart-tooltip').style('visibility', 'hidden');
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

    // Legend
    this.addLegend(g, groups, colorScale, width);
  }

  private addLegend(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    groups: string[],
    colorScale: d3.ScaleOrdinal<string, string>,
    width: number,
  ) {
    const legend = g
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${width - 100}, 10)`);

    groups.forEach((group, i) => {
      const legendRow = legend
        .append('g')
        .attr('transform', `translate(0, ${i * 20})`)
        .style('cursor', 'pointer');

      legendRow
        .append('rect')
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', colorScale(group));

      legendRow
        .append('text')
        .attr('x', 18)
        .attr('y', 10)
        .style('font-size', '11px')
        .text(group);
    });
  }
}

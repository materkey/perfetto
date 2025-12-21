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

interface PieArcDatum extends d3.PieArcDatum<Row> {
  data: Row;
}

export class DonutChartRenderer extends BaseRenderer {
  private selectedSlices = new Set<string>();

  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    if (spec.type !== 'donut') return;

    this.clear(svg);
    const {width, height} = this.getDimensions(svg);
    const g = this.createGroup(svg);

    // Reserve space for legend on the right
    const legendWidth = 120;
    const chartWidth = width - legendWidth;

    // Calculate radius based on available space
    const radius = Math.min(chartWidth, height) / 2 - 10;
    const innerRadius = radius * 0.5;

    // Center the donut chart in the available space (excluding legend)
    const centerX = chartWidth / 2;
    const centerY = height / 2;

    // Create pie layout
    const pie = d3
      .pie<Row>()
      .value((d) => Number(d[spec.value]))
      .sort(null);

    // Create arc generator
    const arc = d3
      .arc<PieArcDatum>()
      .innerRadius(innerRadius)
      .outerRadius(radius);

    // Create color scale
    const categories = data.map((d) => String(d[spec.category]));
    const colorScale = d3
      .scaleOrdinal<string>()
      .domain(categories)
      .range(d3.schemeTableau10);

    // Create arcs group
    const arcsGroup = g
      .append('g')
      .attr('transform', `translate(${centerX},${centerY})`);

    // Draw slices
    const slices = arcsGroup
      .selectAll<SVGPathElement, PieArcDatum>('.arc')
      .data(pie(data))
      .join('path')
      .attr('class', 'arc selectable')
      .attr('d', arc)
      .attr('fill', (d) => colorScale(String(d.data[spec.category])))
      .attr('stroke', 'white')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('opacity', 1.0);

    // Handle click events with shift-click multi-select
    slices.on('click', (event: MouseEvent, d: PieArcDatum) => {
      event.stopPropagation();
      const categoryValue = String(d.data[spec.category]);

      if (event.shiftKey) {
        // Shift-click: toggle selection
        if (this.selectedSlices.has(categoryValue)) {
          this.selectedSlices.delete(categoryValue);
        } else {
          this.selectedSlices.add(categoryValue);
        }
      } else {
        // Regular click: select only this slice
        this.selectedSlices.clear();
        this.selectedSlices.add(categoryValue);
      }

      // Update visual state
      this.updateSliceOpacity(slices, spec.category);

      // Apply filter
      if (this.selectedSlices.size > 0) {
        const values = Array.from(this.selectedSlices);
        this.onFilterRequest?.(spec.category, 'in', values);
      } else {
        // Clear all filters when no slices are selected
        this.onFilterRequest?.('__clear_all__', '=', null);
      }
    });

    // Click on background to clear selection
    d3.select(svg).on('click', (event: MouseEvent) => {
      if (event.target === svg) {
        this.selectedSlices.clear();
        this.updateSliceOpacity(slices, spec.category);
        // Clear all filters when clicking background
        this.onFilterRequest?.('__clear_all__', '=', null);
      }
    });

    // Tooltips
    this.setupTooltip(slices, (d) => {
      const percentage = ((d.endAngle - d.startAngle) / (2 * Math.PI)) * 100;
      return `<strong>${d.data[spec.category]}</strong><br/>${spec.value}: ${formatNumber(Number(d.data[spec.value]))}<br/>Percentage: ${percentage.toFixed(1)}%`;
    });

    // Add legend
    this.addLegend(
      g,
      colorScale,
      chartWidth,
      height,
      spec.category,
      (category) => {
        // Toggle selection when clicking legend
        if (this.selectedSlices.has(category)) {
          this.selectedSlices.delete(category);
        } else {
          this.selectedSlices.add(category);
        }
        this.updateSliceOpacity(slices, spec.category);

        if (this.selectedSlices.size > 0) {
          const values = Array.from(this.selectedSlices);
          this.onFilterRequest?.(spec.category, 'in', values);
        } else {
          // Clear all filters when no slices are selected
          this.onFilterRequest?.('__clear_all__', '=', null);
        }
      },
    );
  }

  private updateSliceOpacity(
    slices: d3.Selection<SVGPathElement, PieArcDatum, SVGGElement, unknown>,
    categoryColumn: string,
  ) {
    if (this.selectedSlices.size === 0) {
      // No selection: show all at full opacity
      slices.style('opacity', 1.0);
    } else {
      // Has selection: dim unselected slices
      slices.style('opacity', (d) => {
        const category = String(d.data[categoryColumn]);
        return this.selectedSlices.has(category) ? 1.0 : 0.2;
      });
    }
  }

  private addLegend(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    colorScale: d3.ScaleOrdinal<string, string>,
    width: number,
    _height: number,
    _categoryColumn: string,
    onClick: (category: string) => void,
  ) {
    const legend = g
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${width + 20}, 0)`);

    const legendItems = legend
      .selectAll('.legend-item')
      .data(colorScale.domain())
      .join('g')
      .attr('class', 'legend-item')
      .attr('transform', (_d, i) => `translate(0, ${i * 20})`)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => onClick(d));

    legendItems
      .append('rect')
      .attr('width', 15)
      .attr('height', 15)
      .attr('fill', (d) => colorScale(d));

    legendItems
      .append('text')
      .attr('x', 20)
      .attr('y', 12)
      .style('font-size', '12px')
      .text((d) => d);
  }
}

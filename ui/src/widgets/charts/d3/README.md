# D3 Chart Library

A clean, testable, and maintainable charting library built with D3.js and Mithril.

## Architecture

This library follows a clean separation of concerns:

- **Data Layer** (`data/`): Handles data fetching, filtering, and aggregation
- **Chart Layer** (`charts/`): Pure D3 rendering logic, separated from data management
- **UI Layer** (`ui/`): Mithril components for integration

## File Structure

```
d3/
├── data/
│   ├── types.ts                 # Filter, Aggregation, Row, ChartSpec types
│   ├── source.ts                # DataSource interface
│   ├── memory_source.ts         # In-memory data source implementation
│   ├── backend_source.ts        # Backend API data source implementation
│   └── filter_store.ts          # Observable filter state + settings management
│
├── charts/
│   ├── base_renderer.ts         # BaseRenderer abstract class with common utilities
│   ├── chart.ts                 # Chart class (data lifecycle + filter subscriptions)
│   ├── registry.ts              # RENDERERS map for chart type lookup
│   ├── bar_chart.ts             # Bar chart renderer
│   ├── histogram.ts             # Histogram renderer
│   ├── cdf.ts                   # CDF (Cumulative Distribution Function) renderer
│   ├── scatter.ts               # Scatter plot renderer
│   │
│   ├── selection/               # Selection strategy pattern
│   │   ├── selection_strategy.ts        # Strategy interface
│   │   ├── filter_selection_strategy.ts # Default: opacity + filters
│   │   └── opacity_selection_strategy.ts # Opacity-only mode
│   │
│   └── brushing/                # Brush behavior pattern
│       ├── brush_behavior.ts    # Brush interface
│       ├── range_brush.ts       # 1D range selection
│       ├── categorical_brush.ts # Categorical selection
│       └── scatter_brush.ts     # 2D rectangular selection
│
├── ui/
│   └── chart_widget.ts          # Mithril component for rendering charts
│
├── utils.ts                     # Utility functions (truncate, formatNumber)
├── index.ts                     # Public API exports
└── README.md                    # This file
```

## Design Principles

### 1. Separation of Concerns
- **Chart** manages data lifecycle and filter subscriptions
- **Renderer** handles pure D3 rendering logic
- **Widget** provides Mithril integration

### 2. Testability
- Renderers can be tested with mock SVG elements
- Charts can be tested with mock data sources
- No tight coupling between layers

### 3. Extensibility
- Add new chart types by creating a new renderer and registering it
- Swap rendering strategies (e.g., Canvas instead of SVG)
- Support multiple data sources (memory, backend, SQL, etc.)

## Usage Example

```typescript
import {
  MemorySource,
  FilterStore,
  Chart,
  ChartWidget,
} from './d3';

// 1. Create a data source
const data = [
  { category: 'A', value: 10 },
  { category: 'B', value: 20 },
  { category: 'C', value: 15 },
];
const dataSource = new MemorySource(data);

// 2. Create a filter store (shared across charts for cross-filtering)
const filterStore = new FilterStore();

// 3. Create a chart
const chart = new Chart(
  {
    type: 'bar',
    x: 'category',
    y: 'value',
    aggregation: 'sum',
  },
  dataSource,
  filterStore,
);

// 4. Render with Mithril
m(ChartWidget, {
  chart,
  onRemove: () => console.log('Remove chart'),
  onDuplicate: () => console.log('Duplicate chart'),
});
```

## Chart Types

### Bar Chart
```typescript
{
  type: 'bar',
  x: 'category_field',
  y: 'value_field',
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max'
}
```

### Histogram
```typescript
{
  type: 'histogram',
  x: 'numeric_field',
  bins?: 20  // Optional, defaults to 20
}
```

### CDF (Cumulative Distribution Function)
```typescript
{
  type: 'cdf',
  x: 'numeric_field',
  colorBy?: 'category_field'  // Optional, for multiple CDFs
}
```

### Scatter Plot
```typescript
{
  type: 'scatter',
  x: 'numeric_field_1',
  y: 'numeric_field_2',
  colorBy?: 'category_field'  // Optional, for colored points
}
```

## Interactive Features

### Brushing & Filtering

All charts support interactive brushing with two modes:

**Filter Mode (default):**
```
User brushes Chart A
    ↓
FilterSelectionStrategy: Apply opacity + Create filters
    ↓
FilterStore notifies all charts
    ↓
ALL charts reload with filtered data
```

**Opacity Mode:**
```
User brushes Chart A
    ↓
OpacitySelectionStrategy: Apply opacity + Create filters
    ↓
FilterStore notifies all charts
    ↓
Chart A: Keeps original data (opacity shows selection)
Charts B-F: Reload with filtered data
```

Toggle between modes using `filterStore.setUpdateSourceChart(true/false)`.

### Other Features
- **Click-to-filter**: Click on chart elements to add filters
- **Tooltips**: Hover over elements to see details
- **Cross-chart filtering**: Filters are shared via FilterStore
- **Brush selection**: Drag to select ranges or categories

## Adding New Chart Types

1. Create a new renderer in `charts/`:
```typescript
// charts/my_chart.ts
import { BaseRenderer } from './base_renderer';

export class MyChartRenderer extends BaseRenderer {
  render(svg: SVGElement, data: Row[], spec: ChartSpec) {
    // Your D3 rendering logic here
  }
}
```

2. Add the chart spec type to `data/types.ts`:
```typescript
export type ChartSpec =
  | { type: 'bar'; ... }
  | { type: 'my_chart'; field: string; ... };
```

3. Register the renderer in `charts/registry.ts`:
```typescript
import { MyChartRenderer } from './my_chart';

export const RENDERERS: Record<string, ChartRenderer> = {
  bar: new BarChartRenderer(),
  my_chart: new MyChartRenderer(),
  // ...
};
```

4. Update the title function in `ui/chart_widget.ts`:
```typescript
function getChartTitle(spec: ChartSpec): string {
  switch (spec.type) {
    case 'my_chart':
      return `My Chart: ${spec.field}`;
    // ...
  }
}
```

## Testing

The architecture makes testing straightforward:

```typescript
// Test a renderer
const renderer = new BarChartRenderer();
const mockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
const mockData = [{ x: 'A', y: 10 }];
const spec = { type: 'bar', x: 'x', y: 'y', aggregation: 'sum' };
renderer.render(mockSvg, mockData, spec);
// Assert SVG contains expected elements

// Test a data source
const source = new MemorySource([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
const result = await source.query([{ col: 'a', op: '>', val: 2 }]);
// Assert result contains filtered data
```

## Advanced Architecture

### Selection Strategy Pattern

The library uses the Strategy pattern to separate visual selection from filter creation:

```
┌─────────────────────────────────────────────────────────┐
│                    SelectionStrategy                     │
│  ┌────────────────────┐  ┌──────────────────────────┐  │
│  │ FilterSelection    │  │ OpacitySelection         │  │
│  │ Strategy           │  │ Strategy                 │  │
│  ├────────────────────┤  ├──────────────────────────┤  │
│  │ • Apply opacity    │  │ • Apply opacity          │  │
│  │ • Create filters   │  │ • Create filters         │  │
│  │ • Source reloads   │  │ • Source keeps data      │  │
│  └────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Key Design:**
- `BaseRenderer` delegates brush handling to the active strategy
- `Chart` sets the strategy based on `FilterStore.updateSourceChart` setting
- Strategies decide whether to reload data or just apply visual feedback
- CDF charts use clip paths for elegant "spotlight" effect in opacity mode

### 2-Phase Filter Notification

```
Phase 1: FilterStore.notify(sourceChartId)
    ↓
Phase 2: Each Chart decides independently
    ↓
    ├─ Source chart + opacity mode → Skip reload
    └─ All other cases → Reload data
```

This allows flexible behavior without tight coupling between charts.

## Future Enhancements

Potential additions:
- Line charts
- Area charts
- Heatmaps
- Box plots
- Violin plots
- Stacked bar charts
- Pie/donut charts
- Export to PNG/SVG
- Responsive sizing
- Dark mode support

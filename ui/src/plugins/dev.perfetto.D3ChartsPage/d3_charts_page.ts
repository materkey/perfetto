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

import m from 'mithril';
import {Trace} from '../../public/trace';
import {D3ChartSqlSource} from '../../components/widgets/d3_chart_sql_source';
import {Chart, FilterStore, ChartSpec} from '../../widgets/charts/d3';
import {ChartWidget} from '../../widgets/d3_chart_widget';
import {Button} from '../../widgets/button';
import {Editor} from '../../widgets/editor';
import {Select} from '../../widgets/select';
import {Icon} from '../../widgets/icon';
import {FormLabel} from '../../widgets/form';
import {Switch} from '../../widgets/switch';
import {DataGrid} from '../../components/widgets/datagrid/datagrid';
import {SchemaRegistry} from '../../components/widgets/datagrid/datagrid_schema';
import {InMemoryDataSource} from '../../components/widgets/datagrid/in_memory_data_source';
import {Row as DataGridRow} from '../../trace_processor/query_result';
import {Filter as DataGridFilter} from '../../components/widgets/datagrid/model';
import {Filter as D3Filter} from '../../widgets/charts/d3/data/types';

interface D3ChartsPageAttrs {
  trace: Trace;
}

const DEFAULT_SQL = `SELECT 
  name,
  category,
  dur,
  ts,
  id
FROM slice
LIMIT 10000`;

// Chart creator state
interface ChartCreatorState {
  selectedType: ChartSpec['type'] | 'table' | '';
  xColumn: string;
  yColumn: string;
  valueColumn: string;
  categoryColumn: string;
  colorByColumn: string;
  groupByColumn: string;
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  bins: number;
  mode: 'grouped' | 'stacked';
  showCorrelation: boolean;
}

// Table view state with filter subscription
interface TableView {
  id: number;
  dataSource: InMemoryDataSource;
  schema: SchemaRegistry;
  columns: string[];
  allFilters: DataGridFilter[]; // All filters (from charts + tables) shown as chips
  filterGroupMap: Map<string, string>; // Maps filter key to filter group ID
  unsubscribe: () => void;
}

export class D3ChartsPage implements m.ClassComponent<D3ChartsPageAttrs> {
  private charts: Chart[] = [];
  private tables: TableView[] = [];
  private filterStore = new FilterStore();
  private sqlQuery = DEFAULT_SQL;
  private trace?: Trace;
  private errorMessage = '';
  private sqlSource?: D3ChartSqlSource;
  private availableColumns: string[] = [];
  private sidebarOpen = false;
  private nextTableId = 0;

  // Chart creator state
  private chartCreator: ChartCreatorState = {
    selectedType: '',
    xColumn: '',
    yColumn: '',
    valueColumn: '',
    categoryColumn: '',
    colorByColumn: '',
    groupByColumn: '',
    aggregation: 'sum',
    bins: 20,
    mode: 'grouped',
    showCorrelation: false,
  };

  oninit({attrs}: m.Vnode<D3ChartsPageAttrs>) {
    this.trace = attrs.trace;
    this.runQuery();
  }

  private async runQuery() {
    if (!this.trace) return;

    const engine = this.trace.engine;
    this.errorMessage = '';

    // Clean up existing charts and tables
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
    this.tables.forEach((table) => table.unsubscribe());
    this.tables = [];

    try {
      // Handle INCLUDE PERFETTO MODULE statements
      // These need to be executed separately before the main query
      const lines = this.sqlQuery.trim().split('\n');
      const includeStatements: string[] = [];
      const queryLines: string[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.toUpperCase().startsWith('INCLUDE PERFETTO MODULE')) {
          includeStatements.push(trimmedLine);
        } else if (trimmedLine) {
          queryLines.push(line);
        }
      }

      // Execute INCLUDE statements first
      for (const includeStmt of includeStatements) {
        await engine.query(includeStmt);
      }

      // Use the remaining query (without INCLUDE statements)
      const actualQuery = queryLines.join('\n').trim();

      if (!actualQuery) {
        this.errorMessage =
          'No SELECT query found. Please add a SELECT statement after the INCLUDE statements.';
        m.redraw();
        return;
      }

      // Create a SQL-based data source with the actual query
      this.sqlSource = new D3ChartSqlSource(engine, actualQuery);

      // Fetch a sample row to get available columns
      const sampleData = await this.sqlSource.query([], undefined);
      if (sampleData.length > 0) {
        this.availableColumns = Object.keys(sampleData[0]);
      } else {
        this.availableColumns = [];
        this.errorMessage =
          'Query executed successfully but returned no data. Try adjusting your query or increasing the LIMIT.';
      }

      m.redraw();
    } catch (error) {
      this.errorMessage = `Error: ${error}`;
      console.error('Query error:', error);
      m.redraw();
    }
  }

  private resetChartCreator() {
    this.chartCreator = {
      selectedType: '',
      xColumn: '',
      yColumn: '',
      valueColumn: '',
      categoryColumn: '',
      colorByColumn: '',
      groupByColumn: '',
      aggregation: 'sum',
      bins: 20,
      mode: 'grouped',
      showCorrelation: false,
    };
  }

  private canCreateChart(): boolean {
    const {selectedType, xColumn, yColumn, valueColumn, categoryColumn} =
      this.chartCreator;

    if (!selectedType) return false;

    switch (selectedType) {
      case 'table':
        return true; // Table doesn't need specific columns
      case 'bar':
        return !!(xColumn && yColumn);
      case 'histogram':
      case 'cdf':
        return !!xColumn;
      case 'scatter':
      case 'boxplot':
      case 'violin':
      case 'line':
        return !!(xColumn && yColumn);
      case 'heatmap':
        return !!(xColumn && yColumn && valueColumn);
      case 'donut':
        return !!(categoryColumn && valueColumn);
      default:
        return false;
    }
  }

  private async createChart() {
    if (!this.canCreateChart() || !this.sqlSource) return;

    const {
      selectedType,
      xColumn,
      yColumn,
      valueColumn,
      categoryColumn,
      colorByColumn,
      groupByColumn,
      aggregation,
      bins,
      mode,
      showCorrelation,
    } = this.chartCreator;

    // Handle table separately
    if (selectedType === 'table') {
      await this.createTable();
      return;
    }

    let spec: ChartSpec;

    switch (selectedType) {
      case 'bar':
        spec = {
          type: 'bar',
          x: xColumn,
          y: yColumn,
          aggregation,
          groupBy: groupByColumn || undefined,
          mode: mode,
        };
        break;
      case 'histogram':
        spec = {
          type: 'histogram',
          x: xColumn,
          bins,
        };
        break;
      case 'cdf':
        spec = {
          type: 'cdf',
          x: xColumn,
          colorBy: colorByColumn || undefined,
        };
        break;
      case 'scatter':
        spec = {
          type: 'scatter',
          x: xColumn,
          y: yColumn,
          colorBy: colorByColumn || undefined,
          showCorrelation: showCorrelation,
        };
        break;
      case 'boxplot':
        spec = {
          type: 'boxplot',
          x: xColumn,
          y: yColumn,
        };
        break;
      case 'violin':
        spec = {
          type: 'violin',
          x: xColumn,
          y: yColumn,
        };
        break;
      case 'line':
        spec = {
          type: 'line',
          x: xColumn,
          y: yColumn,
          colorBy: colorByColumn || undefined,
        };
        break;
      case 'heatmap':
        spec = {
          type: 'heatmap',
          x: xColumn,
          y: yColumn,
          value: valueColumn,
          aggregation,
        };
        break;
      case 'donut':
        spec = {
          type: 'donut',
          category: categoryColumn,
          value: valueColumn,
          aggregation,
        };
        break;
      default:
        return;
    }

    this.charts.push(new Chart(spec, this.sqlSource, this.filterStore));
    this.resetChartCreator();
    m.redraw();
  }

  private async createTable() {
    if (!this.sqlSource) return;

    try {
      // Fetch all data for the table
      const data = await this.sqlSource.query([], undefined);

      if (data.length === 0) {
        this.errorMessage = 'No data available to display in table';
        m.redraw();
        return;
      }

      // Build schema from available columns
      const columnSchema: Record<string, {}> = {};
      for (const col of this.availableColumns) {
        columnSchema[col] = {};
      }

      const schema: SchemaRegistry = {
        data: columnSchema,
      };

      // Convert D3 Row type to DataGrid Row type (filter out undefined, convert booleans)
      const dataGridData: DataGridRow[] = data.map((row) => {
        const cleanRow: DataGridRow = {};
        for (const key in row) {
          if (!row.hasOwnProperty(key)) continue;
          const value = row[key];
          if (value !== undefined) {
            // Convert boolean to number (DataGrid doesn't support boolean)
            cleanRow[key] =
              typeof value === 'boolean' ? (value ? 1 : 0) : value;
          }
        }
        return cleanRow;
      });

      const dataSource = new InMemoryDataSource(dataGridData);

      // Initialize with empty filters
      const tableView: TableView = {
        id: this.nextTableId++,
        dataSource,
        schema,
        columns: this.availableColumns,
        allFilters: [], // All filters (from charts + tables)
        filterGroupMap: new Map(), // Maps filter key to group ID
        unsubscribe: () => {}, // Will be set below
      };

      // Subscribe to filter changes - convert D3 filters to DataGrid format and update
      const unsubscribe = this.filterStore.subscribe((notification) => {
        // Convert all D3 filters to DataGrid format
        const dataGridFilters: DataGridFilter[] = notification.filters.map(
          (f) => {
            if (f.val === null) {
              // Null value filters
              return {
                field: f.col,
                op: f.op as 'is null' | 'is not null',
              } as DataGridFilter;
            } else {
              // Value-based filters
              return {
                field: f.col,
                op: f.op as Exclude<
                  DataGridFilter['op'],
                  'is null' | 'is not null'
                >,
                value: f.val,
              } as DataGridFilter;
            }
          },
        );

        // Build a map from filter key to group ID
        const filterGroupMap = new Map<string, string>();
        for (const group of this.filterStore.getFilterGroups()) {
          for (const filter of group.filters) {
            const key = `${filter.col}:${filter.op}:${JSON.stringify(filter.val)}`;
            filterGroupMap.set(key, group.id);
          }
        }

        tableView.allFilters = dataGridFilters;
        tableView.filterGroupMap = filterGroupMap;
        m.redraw();
      });

      tableView.unsubscribe = unsubscribe;
      this.tables.push(tableView);

      this.resetChartCreator();
      m.redraw();
    } catch (error) {
      this.errorMessage = `Error creating table: ${error}`;
      console.error('Table creation error:', error);
      m.redraw();
    }
  }

  /**
   * Convert DataGrid filters to D3 chart filters.
   */
  private convertDataGridFiltersToD3(
    dataGridFilters: readonly DataGridFilter[],
  ): D3Filter[] {
    return dataGridFilters.map((filter) => {
      const col = filter.field;
      const op = filter.op;

      // Convert value back (numbers to booleans if needed, though we don't have that info)
      let val: D3Filter['val'];
      if ('value' in filter) {
        val = filter.value as D3Filter['val'];
      } else {
        val = null;
      }

      return {col, op: op as D3Filter['op'], val};
    });
  }

  private removeChart(index: number) {
    const chart = this.charts[index];
    if (chart !== undefined) {
      chart.destroy();
      this.charts.splice(index, 1);
      m.redraw();
    }
  }

  private removeTable(index: number) {
    const table = this.tables[index];
    if (table !== undefined) {
      // Unsubscribe from filter updates
      table.unsubscribe();
      this.tables.splice(index, 1);
      m.redraw();
    }
  }

  view() {
    return m(
      '.d3-charts-page',
      {
        style: {
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
        },
      },
      [
        // Main content area
        m(
          '.main-content',
          {
            style: {
              flex: '1',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            },
          },
          [
            // SQL Editor Section
            m(
              '.sql-editor-section',
              {
                style: {
                  background: 'var(--pf-color-background)',
                  borderBottom: '1px solid var(--pf-color-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: '200px',
                  maxHeight: '400px',
                },
              },
              [
                m(
                  '.editor-header.pf-stack.pf-stack--horiz.pf-spacing-medium',
                  {
                    style: {
                      padding: '8px 16px',
                      borderBottom: '1px solid var(--pf-color-border)',
                      background: 'var(--pf-color-background-secondary)',
                      alignItems: 'center',
                    },
                  },
                  [
                    m(Button, {
                      label: 'Run Query',
                      icon: 'play_arrow',
                      onclick: () => this.runQuery(),
                    }),
                    m('.pf-stack.pf-stack--horiz.pf-spacing-medium', [
                      'or press',
                      m('span.pf-hotkey', [
                        m(
                          'span.pf-keycap.pf-spacing-medium',
                          m(Icon, {icon: 'keyboard_command_key'}),
                        ),
                        m(
                          'span.pf-keycap.pf-spacing-medium',
                          m(Icon, {icon: 'keyboard_return'}),
                        ),
                      ]),
                    ]),
                    m('.pf-stack-auto'),
                    m(Switch, {
                      label: 'Update source chart',
                      checked: this.filterStore.getUpdateSourceChart(),
                      onchange: (e: Event) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        this.filterStore.setUpdateSourceChart(checked);
                      },
                    }),
                  ],
                ),
                m(
                  '.editor-container',
                  {style: {flex: 1, overflow: 'hidden'}},
                  m(Editor, {
                    text: this.sqlQuery,
                    language: 'perfetto-sql',
                    fillHeight: true,
                    onUpdate: (text: string) => {
                      this.sqlQuery = text;
                    },
                    onExecute: () => this.runQuery(),
                  }),
                ),
                this.errorMessage &&
                  m(
                    '.error-message',
                    {
                      style: {
                        padding: '8px 16px',
                        background: 'var(--pf-color-error-background)',
                        borderTop: '1px solid var(--pf-color-error)',
                        color: 'var(--pf-color-error)',
                        fontSize: '12px',
                      },
                    },
                    this.errorMessage,
                  ),
              ],
            ),

            // Charts Column
            m(
              '.charts-column',
              {
                style: {
                  flex: 1,
                  overflow: 'auto',
                  padding: '16px',
                  background: 'var(--pf-color-background-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                },
              },
              this.charts.length === 0 && this.tables.length === 0
                ? m(
                    '.empty-state',
                    {
                      onclick: () => {
                        this.sidebarOpen = true;
                        // Trigger chart re-render after sidebar opens
                        setTimeout(() => {
                          this.charts.forEach((chart) => chart.refresh());
                          m.redraw();
                        }, 300);
                      },
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--pf-color-text-secondary)',
                        gap: '16px',
                        cursor: 'pointer',
                        transition: 'color 0.2s ease',
                      },
                      onmouseover: (e: MouseEvent) => {
                        (e.currentTarget as HTMLElement).style.color =
                          'var(--pf-color-text-primary)';
                      },
                      onmouseout: (e: MouseEvent) => {
                        (e.currentTarget as HTMLElement).style.color =
                          'var(--pf-color-text-secondary)';
                      },
                    },
                    [
                      m(Icon, {icon: 'add_circle', style: {fontSize: '64px'}}),
                      m(
                        'p',
                        {style: {fontSize: '16px', fontWeight: 500}},
                        'Click to create your first chart',
                      ),
                    ],
                  )
                : [
                    // Render charts
                    ...this.charts.map((chart, index) =>
                      m(
                        '.chart-wrapper',
                        {
                          key: `chart-${index}`,
                          style: {
                            position: 'relative',
                            background: 'var(--pf-color-background)',
                            borderRadius: '4px',
                            border: '1px solid var(--pf-color-border)',
                          },
                        },
                        [
                          m(
                            'button.pf-button.pf-button--minimal',
                            {
                              onclick: () => this.removeChart(index),
                              style: {
                                position: 'absolute',
                                top: '8px',
                                right: '8px',
                                zIndex: 10,
                              },
                            },
                            m(Icon, {icon: 'close'}),
                          ),
                          m(ChartWidget, {chart}),
                        ],
                      ),
                    ),
                    // Render tables
                    ...this.tables.map((table, index) =>
                      m(
                        '.table-wrapper',
                        {
                          key: `table-${table.id}`,
                          style: {
                            position: 'relative',
                            background: 'var(--pf-color-background)',
                            borderRadius: '4px',
                            border: '1px solid var(--pf-color-border)',
                            minHeight: '400px',
                          },
                        },
                        [
                          m(
                            'button.pf-button.pf-button--minimal',
                            {
                              onclick: () => this.removeTable(index),
                              style: {
                                position: 'absolute',
                                top: '8px',
                                right: '8px',
                                zIndex: 10,
                              },
                            },
                            m(Icon, {icon: 'close'}),
                          ),
                          m(DataGrid, {
                            schema: table.schema,
                            rootSchema: 'data',
                            data: table.dataSource,
                            initialColumns: table.columns.map((col) => ({
                              field: col,
                            })),
                            filters: table.allFilters,
                            onFiltersChanged: (newFilters) => {
                              // Determine which filters were removed
                              const removedFilters = table.allFilters.filter(
                                (oldFilter) => {
                                  return !newFilters.some((newFilter) => {
                                    const oldKey = `${oldFilter.field}:${oldFilter.op}:${JSON.stringify('value' in oldFilter ? oldFilter.value : null)}`;
                                    const newKey = `${newFilter.field}:${newFilter.op}:${JSON.stringify('value' in newFilter ? newFilter.value : null)}`;
                                    return oldKey === newKey;
                                  });
                                },
                              );

                              // For each removed filter, find its group and clear it
                              for (const removedFilter of removedFilters) {
                                const key = `${removedFilter.field}:${removedFilter.op}:${JSON.stringify('value' in removedFilter ? removedFilter.value : null)}`;
                                const groupId = table.filterGroupMap.get(key);
                                if (groupId) {
                                  this.filterStore.clearFilterGroup(
                                    groupId,
                                    `table-${table.id}`,
                                  );
                                }
                              }

                              // Determine which filters were added (exist in newFilters but not in allFilters)
                              const addedFilters = newFilters.filter(
                                (newFilter) => {
                                  return !table.allFilters.some((oldFilter) => {
                                    const oldKey = `${oldFilter.field}:${oldFilter.op}:${JSON.stringify('value' in oldFilter ? oldFilter.value : null)}`;
                                    const newKey = `${newFilter.field}:${newFilter.op}:${JSON.stringify('value' in newFilter ? newFilter.value : null)}`;
                                    return oldKey === newKey;
                                  });
                                },
                              );

                              // If there are new filters added by the table, create a filter group
                              if (addedFilters.length > 0) {
                                const d3Filters =
                                  this.convertDataGridFiltersToD3(addedFilters);
                                this.filterStore.setFilterGroup(
                                  {
                                    id: `table-${table.id}-${Date.now()}`,
                                    filters: d3Filters,
                                    label: 'Table filter',
                                  },
                                  `table-${table.id}`,
                                );
                              }
                            },
                            fillHeight: false,
                            showExportButton: true,
                          }),
                        ],
                      ),
                    ),
                  ],
            ),
          ],
        ),

        // Right sidebar for chart creation
        this.sidebarOpen &&
          m(
            '.chart-creator-sidebar',
            {
              style: {
                width: '320px',
                background: 'var(--pf-color-background)',
                borderLeft: '1px solid var(--pf-color-border)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              },
            },
            [
              m(
                '.sidebar-header',
                {
                  style: {
                    padding: '8px 16px',
                    borderBottom: '1px solid var(--pf-color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--pf-color-background-secondary)',
                  },
                },
                [
                  m(
                    'h3',
                    {style: {margin: 0, fontSize: '14px', fontWeight: 500}},
                    'Add Chart',
                  ),
                  m(Button, {
                    icon: 'close',
                    onclick: () => {
                      this.sidebarOpen = false;
                      // Trigger chart re-render after sidebar closes to fill new space
                      setTimeout(() => {
                        this.charts.forEach((chart) => chart.refresh());
                        m.redraw();
                      }, 300); // Wait for CSS transition
                    },
                  }),
                ],
              ),
              m(
                '.sidebar-content',
                {
                  style: {
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    overflowY: 'auto',
                    flex: 1,
                  },
                },
                [
                  // Chart Type
                  m(
                    FormLabel,
                    {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      },
                    },
                    [
                      m(
                        'span',
                        {style: {fontSize: '12px', fontWeight: 500}},
                        'Chart Type',
                      ),
                      m(
                        Select,
                        {
                          value: this.chartCreator.selectedType,
                          onchange: (e: Event) => {
                            this.chartCreator.selectedType = (
                              e.target as HTMLSelectElement
                            ).value as ChartSpec['type'];
                          },
                        },
                        [
                          m('option', {value: ''}, 'Select chart type...'),
                          m('option', {value: 'table'}, 'Table'),
                          m('option', {value: 'bar'}, 'Bar Chart'),
                          m('option', {value: 'histogram'}, 'Histogram'),
                          m('option', {value: 'cdf'}, 'CDF'),
                          m('option', {value: 'scatter'}, 'Scatter Plot'),
                          m('option', {value: 'boxplot'}, 'Box Plot'),
                          m('option', {value: 'violin'}, 'Violin Plot'),
                          m('option', {value: 'line'}, 'Line Chart'),
                          m('option', {value: 'heatmap'}, 'Heatmap'),
                          m('option', {value: 'donut'}, 'Donut Chart'),
                        ],
                      ),
                    ],
                  ),

                  // X Column (for most charts)
                  [
                    'bar',
                    'histogram',
                    'cdf',
                    'scatter',
                    'boxplot',
                    'violin',
                    'line',
                    'heatmap',
                  ].includes(this.chartCreator.selectedType) &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'X Column',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.xColumn,
                            onchange: (e: Event) => {
                              this.chartCreator.xColumn = (
                                e.target as HTMLSelectElement
                              ).value;
                            },
                          },
                          [
                            m('option', {value: ''}, 'Select column...'),
                            ...this.availableColumns.map((col) =>
                              m('option', {value: col}, col),
                            ),
                          ],
                        ),
                      ],
                    ),

                  // Y Column
                  [
                    'bar',
                    'scatter',
                    'boxplot',
                    'violin',
                    'line',
                    'heatmap',
                  ].includes(this.chartCreator.selectedType) &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Y Column',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.yColumn,
                            onchange: (e: Event) => {
                              this.chartCreator.yColumn = (
                                e.target as HTMLSelectElement
                              ).value;
                            },
                          },
                          [
                            m('option', {value: ''}, 'Select column...'),
                            ...this.availableColumns.map((col) =>
                              m('option', {value: col}, col),
                            ),
                          ],
                        ),
                      ],
                    ),

                  // Value Column (for heatmap and donut)
                  ['heatmap', 'donut'].includes(
                    this.chartCreator.selectedType,
                  ) &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Value Column',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.valueColumn,
                            onchange: (e: Event) => {
                              this.chartCreator.valueColumn = (
                                e.target as HTMLSelectElement
                              ).value;
                            },
                          },
                          [
                            m('option', {value: ''}, 'Select column...'),
                            ...this.availableColumns.map((col) =>
                              m('option', {value: col}, col),
                            ),
                          ],
                        ),
                      ],
                    ),

                  // Category Column (for donut)
                  this.chartCreator.selectedType === 'donut' &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Category Column',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.categoryColumn,
                            onchange: (e: Event) => {
                              this.chartCreator.categoryColumn = (
                                e.target as HTMLSelectElement
                              ).value;
                            },
                          },
                          [
                            m('option', {value: ''}, 'Select column...'),
                            ...this.availableColumns.map((col) =>
                              m('option', {value: col}, col),
                            ),
                          ],
                        ),
                      ],
                    ),

                  // Color By (optional for scatter, cdf, line)
                  ['scatter', 'cdf', 'line'].includes(
                    this.chartCreator.selectedType,
                  ) &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Color By (Optional)',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.colorByColumn,
                            onchange: (e: Event) => {
                              this.chartCreator.colorByColumn = (
                                e.target as HTMLSelectElement
                              ).value;
                            },
                          },
                          [
                            m('option', {value: ''}, 'None'),
                            ...this.availableColumns.map((col) =>
                              m('option', {value: col}, col),
                            ),
                          ],
                        ),
                      ],
                    ),

                  // Group By (optional for bar)
                  this.chartCreator.selectedType === 'bar' &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Group By (Optional)',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.groupByColumn,
                            onchange: (e: Event) => {
                              this.chartCreator.groupByColumn = (
                                e.target as HTMLSelectElement
                              ).value;
                            },
                          },
                          [
                            m('option', {value: ''}, 'None'),
                            ...this.availableColumns.map((col) =>
                              m('option', {value: col}, col),
                            ),
                          ],
                        ),
                      ],
                    ),

                  // Mode (for bar chart with groupBy)
                  this.chartCreator.selectedType === 'bar' &&
                    this.chartCreator.groupByColumn &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Mode',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.mode,
                            onchange: (e: Event) => {
                              this.chartCreator.mode = (
                                e.target as HTMLSelectElement
                              ).value as 'grouped' | 'stacked';
                            },
                          },
                          [
                            m('option', {value: 'grouped'}, 'Grouped'),
                            m('option', {value: 'stacked'}, 'Stacked'),
                          ],
                        ),
                      ],
                    ),

                  // Show Correlation (for scatter plot)
                  this.chartCreator.selectedType === 'scatter' &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'row',
                          gap: '8px',
                          alignItems: 'center',
                        },
                      },
                      [
                        m('input[type=checkbox].pf-checkbox', {
                          checked: this.chartCreator.showCorrelation,
                          onchange: (e: Event) => {
                            this.chartCreator.showCorrelation = (
                              e.target as HTMLInputElement
                            ).checked;
                          },
                        }),
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Show Correlation Line',
                        ),
                      ],
                    ),

                  // Aggregation (for bar, heatmap, donut)
                  ['bar', 'heatmap', 'donut'].includes(
                    this.chartCreator.selectedType,
                  ) &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Aggregation',
                        ),
                        m(
                          Select,
                          {
                            value: this.chartCreator.aggregation,
                            onchange: (e: Event) => {
                              this.chartCreator.aggregation = (
                                e.target as HTMLSelectElement
                              ).value as
                                | 'sum'
                                | 'avg'
                                | 'count'
                                | 'min'
                                | 'max';
                            },
                          },
                          [
                            m('option', {value: 'sum'}, 'Sum'),
                            m('option', {value: 'avg'}, 'Average'),
                            m('option', {value: 'count'}, 'Count'),
                            m('option', {value: 'min'}, 'Min'),
                            m('option', {value: 'max'}, 'Max'),
                          ],
                        ),
                      ],
                    ),

                  // Bins (for histogram)
                  this.chartCreator.selectedType === 'histogram' &&
                    m(
                      FormLabel,
                      {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        },
                      },
                      [
                        m(
                          'span',
                          {style: {fontSize: '12px', fontWeight: 500}},
                          'Number of Bins',
                        ),
                        m('input.pf-text-input[type=number]', {
                          value: this.chartCreator.bins,
                          oninput: (e: Event) => {
                            this.chartCreator.bins = parseInt(
                              (e.target as HTMLInputElement).value,
                              10,
                            );
                          },
                        }),
                      ],
                    ),

                  // Create button
                  m(Button, {
                    label: 'Create Chart',
                    icon: 'add_chart',
                    disabled: !this.canCreateChart(),
                    onclick: () => this.createChart(),
                  }),
                ],
              ),
            ],
          ),

        // Floating action button (when sidebar closed)
        !this.sidebarOpen &&
          m(
            'button.pf-button.pf-button--filled',
            {
              onclick: () => {
                this.sidebarOpen = true;
                // Trigger chart re-render after sidebar opens
                setTimeout(() => {
                  this.charts.forEach((chart) => chart.refresh());
                  m.redraw();
                }, 300);
              },
              style: {
                position: 'fixed',
                right: '24px',
                bottom: '24px',
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            },
            m(Icon, {icon: 'add'}),
          ),
      ],
    );
  }

  onremove() {
    // Clean up charts and tables when page is removed
    this.charts.forEach((chart) => chart.destroy());
    this.charts = [];
    this.tables.forEach((table) => table.unsubscribe());
    this.tables = [];
  }
}

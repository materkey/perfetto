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

import {Time} from '../../base/time';
import {
  BaseCounterTrack,
  CounterOptions,
} from '../../components/tracks/base_counter_track';
import {TrackEventDetails} from '../../public/selection';
import {Trace} from '../../public/trace';
import {TrackMouseEvent} from '../../public/track';
import {LONG, LONG_NULL, NUM} from '../../trace_processor/query_result';
import {CounterDetailsPanel} from './counter_details_panel';

export class TraceProcessorCounterTrack extends BaseCounterTrack {
  constructor(
    trace: Trace,
    uri: string,
    options: Partial<CounterOptions>,
    private readonly trackId: number,
    private readonly trackName: string,
    private readonly rootTable: string = 'counter',
  ) {
    super(trace, uri, options);
  }

  async onInit(): Promise<void> {
    // Query the process end_ts for this track's associated process (if any).
    // This allows the counter graph to be clipped at process termination
    // instead of extending to the right edge of the viewport.
    //
    // We try multiple approaches:
    // 1. Get end_ts from process table (set by sched_process_free ftrace event)
    // 2. If end_ts is NULL, use the last counter timestamp as a proxy
    //    (this happens when ftrace events are not available, e.g., in Docker)
    const query = `
      SELECT
        p.end_ts,
        (SELECT MAX(c.ts) FROM counter c WHERE c.track_id = ${this.trackId}) as last_counter_ts
      FROM process_counter_track pct
      JOIN process p ON pct.upid = p.upid
      WHERE pct.id = ${this.trackId}
    `;
    try {
      const result = await this.engine.query(query);
      const it = result.iter({end_ts: LONG_NULL, last_counter_ts: LONG_NULL});
      if (it.valid()) {
        if (it.end_ts !== null) {
          this.processEndTs = Time.fromRaw(it.end_ts);
          console.log(
            `[ProcessEndTs] Track ${this.trackId}: end_ts=${it.end_ts}`,
          );
        } else if (it.last_counter_ts !== null) {
          // Use last counter timestamp as proxy for process end
          this.processEndTs = Time.fromRaw(it.last_counter_ts);
          console.log(
            `[ProcessEndTs] Track ${this.trackId}: last_counter_ts=${it.last_counter_ts}`,
          );
        }
      }
    } catch (e) {
      // Query failed - track is not a process_counter_track, ignore
      console.log(
        `[ProcessEndTs] Track ${this.trackId}: query failed (not a process counter track)`,
      );
    }
  }

  getSqlSource() {
    return `
      select
        id,
        ts,
        value
      from ${this.rootTable}
      where track_id = ${this.trackId}
    `;
  }

  onMouseClick({x, timescale}: TrackMouseEvent): boolean {
    const time = timescale.pxToHpTime(x).toTime('floor');

    const query = `
      select
        id
      from ${this.rootTable}
      where
        track_id = ${this.trackId}
        and ts < ${time}
      order by ts DESC
      limit 1
    `;

    this.engine.query(query).then((result) => {
      const it = result.iter({
        id: NUM,
      });
      if (!it.valid()) {
        return;
      }
      const id = it.id;
      this.trace.selection.selectTrackEvent(this.uri, id);
    });

    return true;
  }

  // We must define this here instead of in `BaseCounterTrack` because
  // `BaseCounterTrack` does not require the query to have an id column. Here,
  // however, we make the assumption that `rootTable` has an id column, as we
  // need it ot make selections in `onMouseClick` above. Whether or not we
  // SHOULD assume `rootTable` has an id column is another matter...
  async getSelectionDetails(id: number): Promise<TrackEventDetails> {
    const query = `
      WITH CTE AS (
        SELECT
          id,
          ts as leftTs
        FROM ${this.rootTable}
        WHERE track_id = ${this.trackId} AND id = ${id}
      )
      SELECT
        *,
        (
          SELECT
            ts
          FROM ${this.rootTable}
          WHERE track_id = ${this.trackId} AND ts > leftTs
          ORDER BY ts ASC
          LIMIT 1
        ) as rightTs
      FROM CTE
    `;

    const counter = await this.engine.query(query);
    const row = counter.iter({
      leftTs: LONG,
      rightTs: LONG_NULL,
    });
    const leftTs = Time.fromRaw(row.leftTs);
    const rightTs = row.rightTs !== null ? Time.fromRaw(row.rightTs) : leftTs;
    const duration = rightTs - leftTs;
    return {ts: leftTs, dur: duration};
  }

  detailsPanel() {
    return new CounterDetailsPanel(this.trace, this.trackId, this.trackName);
  }
}

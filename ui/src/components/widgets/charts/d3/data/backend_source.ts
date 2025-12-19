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

import {DataSource} from './source';
import {Filter, Aggregation, Row} from './types';

export class BackendSource implements DataSource {
  constructor(private endpoint: string) {}

  async query(filters: Filter[], aggregation?: Aggregation): Promise<Row[]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filters, aggregation}),
    });

    if (!res.ok) {
      throw new Error(`Query failed: ${res.statusText}`);
    }

    return res.json();
  }
}

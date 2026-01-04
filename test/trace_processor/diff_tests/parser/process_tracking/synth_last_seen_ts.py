#!/usr/bin/env python3
# Copyright (C) 2025 The Android Open Source Project
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# This synthetic trace tests the last_seen_ts fallback for process end_ts.
# When ftrace events (sched_process_free) are unavailable (e.g., in Docker),
# last_seen_ts from /proc polling is used as a fallback for process.end_ts.
#
# Test scenarios:
# - Process 100: has last_seen_ts but no sched_process_free -> end_ts = last_seen_ts
# - Process 200: has both last_seen_ts and sched_process_free -> end_ts = from ftrace
# - Process 300: has neither -> end_ts = NULL

from os import sys

import synth_common

trace = synth_common.create_trace()

# Create process 100: will only have last_seen_ts (no ftrace exit)
trace.add_packet(ts=1_000_000_000)
trace.add_process(100, 1, "no_ftrace")

# Process stats with last_seen_ts for process 100
packet = trace.add_packet()
packet.timestamp = 2_000_000_000
ps = packet.process_stats.processes.add()
ps.pid = 100
ps.last_seen_ts = 5_000_000_000  # This should become end_ts

# Create process 200: will have both last_seen_ts and sched_process_free
trace.add_packet(ts=1_000_000_000)
trace.add_process(200, 1, "with_ftrace")

# Process stats with last_seen_ts for process 200
packet = trace.add_packet()
packet.timestamp = 2_000_000_000
ps = packet.process_stats.processes.add()
ps.pid = 200
ps.last_seen_ts = 5_000_000_000  # This should NOT become end_ts

# sched_process_free for process 200 at 3s (earlier than last_seen_ts)
trace.add_ftrace_packet(cpu=0)
trace.add_process_free(ts=3_000_000_000, tid=200, comm="with_ftrace", prio=0)

# Create process 300: has neither last_seen_ts nor sched_process_free
trace.add_packet(ts=1_000_000_000)
trace.add_process(300, 1, "no_end")

sys.stdout.buffer.write(trace.trace.SerializeToString())

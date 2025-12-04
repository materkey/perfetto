/*
 * Copyright (C) 2025 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "src/trace_processor/importers/proto/protovm_incremental_tracing.h"

#include <memory>
#include <optional>

#include "perfetto/protozero/scattered_heap_buffer.h"

#include "protos/perfetto/trace/proto_vm.pbzero.h"
#include "protos/perfetto/trace/trace_packet.pbzero.h"

namespace perfetto {
namespace trace_processor {

void ProtoVmIncrementalTracing::InstantiateProtoVm(protozero::ConstBytes blob) {
  protos::pbzero::ProtoVm::Decoder vm_decoder(blob);
  auto program = vm_decoder.program().ToStdString();
  // TODO(keanmariotti): Plumb memory limit from config.
  vms_.push_back(std::make_unique<protovm::Vm>(std::move(program), 1000000));
  protovm::Vm* vm = vms_.back().get();
  for (auto it = vm_decoder.pid(); it; ++it) {
    pid_to_vm_.emplace(*it, vm);
  }
}

std::optional<TraceBlob> ProtoVmIncrementalTracing::TryProcessPatch(
    const TraceBlobView& blob) {
  protos::pbzero::TracePacket::Decoder patch(blob.data(), blob.size());
  if (!patch.has_trusted_pid()) {
    return std::nullopt;
  }
  auto it = pid_to_vm_.find(patch.trusted_pid());
  if (it == pid_to_vm_.end()) {
    return std::nullopt;
  }
  auto status = it->second->ApplyPatch({blob.data(), blob.size()});
  if (!status.IsOk()) {
    return std::nullopt;
  }

  std::string incremental_state_without_trusted_fields =
      it->second->SerializeIncrementalState();

  protozero::HeapBuffered<protos::pbzero::TracePacket> incremental_state;
  incremental_state->AppendRawProtoBytes(
      incremental_state_without_trusted_fields.data(),
      incremental_state_without_trusted_fields.size());
  incremental_state->set_trusted_uid(patch.trusted_uid());
  incremental_state->set_trusted_pid(patch.trusted_pid());
  incremental_state->set_trusted_packet_sequence_id(
      patch.trusted_packet_sequence_id());

  auto serialized = incremental_state.SerializeAsString();
  return TraceBlob::CopyFrom(serialized.data(), serialized.size());
}

}  // namespace trace_processor
}  // namespace perfetto

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

#ifndef SRC_TRACE_PROCESSOR_IMPORTERS_PROTO_PROTOVM_INCREMENTAL_TRACING_H_
#define SRC_TRACE_PROCESSOR_IMPORTERS_PROTO_PROTOVM_INCREMENTAL_TRACING_H_

#include <map>
#include <memory>
#include <optional>
#include <vector>

#include "perfetto/protozero/field.h"
#include "perfetto/trace_processor/trace_blob.h"
#include "perfetto/trace_processor/trace_blob_view.h"
#include "src/protovm/vm.h"

namespace perfetto {

namespace protovm {
class Vm;
}

namespace trace_processor {

class ProtoVmIncrementalTracing {
 public:
  void InstantiateProtoVm(protozero::ConstBytes blob);
  std::optional<TraceBlob> TryProcessPatch(const TraceBlobView& packet);

 private:
  std::vector<std::unique_ptr<protovm::Vm>> vms_;
  std::multimap<int32_t, protovm::Vm*> pid_to_vm_;
};

}  // namespace trace_processor
}  // namespace perfetto

#endif  // SRC_TRACE_PROCESSOR_IMPORTERS_PROTO_PROTOVM_INCREMENTAL_TRACING_H_

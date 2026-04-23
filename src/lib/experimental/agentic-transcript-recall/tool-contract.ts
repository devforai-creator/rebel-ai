import { z } from 'zod'
import type { SerializableFunctionToolContract } from '@/lib/llm/function-tool-contract'
import type { AgenticTranscriptRecallToolChoiceGateDecision } from './tool-choice-gate'
import type { AgenticTranscriptRecallSourceMap } from './source-map'
import {
  EXPAND_SOURCE_RANGE_TOOL_DESCRIPTION,
  EXPAND_SOURCE_RANGE_TOOL_NAME,
  expandSourceRangeToolInputSchema,
} from './expand-tool'
import {
  FETCH_SOURCE_RANGE_TOOL_DESCRIPTION,
  FETCH_SOURCE_RANGE_TOOL_NAME,
  fetchSourceRangeToolInputSchema,
} from './tool'

function resolveSerializableToolChoice(
  toolChoice: AgenticTranscriptRecallToolChoiceGateDecision['toolChoice'] | null | undefined,
): SerializableFunctionToolContract['toolChoice'] {
  switch (toolChoice) {
    case 'required':
      return { type: 'required' }
    case 'auto':
    default:
      return { type: 'auto' }
  }
}

export function buildAgenticTranscriptRecallToolContract({
  sourceMap,
  toolChoice,
}: {
  sourceMap: AgenticTranscriptRecallSourceMap | null
  toolChoice?: AgenticTranscriptRecallToolChoiceGateDecision['toolChoice'] | null
}): SerializableFunctionToolContract | null {
  if (!sourceMap) {
    return null
  }

  const tools: SerializableFunctionToolContract['tools'] = []

  if (sourceMap.navigationParents.length > 0) {
    tools.push({
      name: EXPAND_SOURCE_RANGE_TOOL_NAME,
      description: EXPAND_SOURCE_RANGE_TOOL_DESCRIPTION,
      inputSchema: z.toJSONSchema(expandSourceRangeToolInputSchema),
    })
  }

  if (sourceMap.directFetchRanges.length > 0) {
    tools.push({
      name: FETCH_SOURCE_RANGE_TOOL_NAME,
      description: FETCH_SOURCE_RANGE_TOOL_DESCRIPTION,
      inputSchema: z.toJSONSchema(fetchSourceRangeToolInputSchema),
    })
  }

  if (tools.length === 0) {
    return null
  }

  return {
    tools,
    toolChoice: resolveSerializableToolChoice(toolChoice),
  }
}

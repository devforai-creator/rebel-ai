export type SerializableFunctionToolChoice =
  | { type: 'auto' }
  | { type: 'none' }
  | { type: 'required' }
  | { type: 'tool'; toolName: string }

export type SerializableFunctionToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type SerializableFunctionToolContract = {
  tools: SerializableFunctionToolDefinition[]
  toolChoice?: SerializableFunctionToolChoice
}

export type ExplicitMemoryScope = 'chat' | 'character'
export type ExplicitMemoryKind =
  | 'preference'
  | 'boundary'
  | 'promise'
  | 'canon_fact'
  | 'user_profile'
export type ExplicitMemoryStatus = 'active' | 'superseded' | 'retracted'
export type ExplicitMemoryEntry = {
  id: string
  scope: ExplicitMemoryScope
  scopeKey: string
  kind: ExplicitMemoryKind
  statement: string
  sourceChatId: string
  sourceStartSeq: number
  sourceEndSeq: number
  createdBy: 'model' | 'user' | 'system'
  admissionSource: 'tool_proposal' | 'extractor' | 'manual'
  status: ExplicitMemoryStatus
  supersedesId: string | null
  createdAt: string
  lastUsedAt: string | null
}

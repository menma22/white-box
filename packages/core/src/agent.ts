import type { ID, Priority } from './types.js'

export interface AgentPlanEntry {
  title: string
  notes?: string
  projectId?: ID | null
  parentId?: ID | null
  parentIndex?: number
  goalNodeId?: ID | null
  priority?: Priority
  due?: string | null
}

export interface TaskSuggestion {
  id: ID
  sessionId: ID
  taskId: ID | null
  title: string
  reason: string
  markDone: boolean
  status: 'pending' | 'accepted' | 'dismissed'
  createdAt: number
  resolvedAt: number | null
}

export interface AgentRequestRecord {
  fingerprint: string
  taskIds: ID[]
}

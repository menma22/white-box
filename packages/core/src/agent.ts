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

export interface AgentRequestRecord {
  fingerprint: string
  taskIds: ID[]
}

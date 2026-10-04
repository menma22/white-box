import { z } from 'zod'

export const AgentRequestsSchema = z.record(z.string(), z.object({ fingerprint: z.string(), taskIds: z.array(z.string()) }))

export const AgentPlanEntrySchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000).optional(),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  parentIndex: z.number().int().min(0).optional(),
  goalNodeId: z.string().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  due: z.string().nullable().optional(),
}).refine((entry) => entry.parentIndex === undefined || entry.parentId == null, '親はIDまたは案の番号のどちらかで指定する')


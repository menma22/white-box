import type { Ctx } from './ports.js'
import type { Handlers } from './handlers.js'
import { commitChanges } from './commit.js'
import { createFixedWork, reuseWeeklyDefaults, setWeeklyBudget, updateFixedWork } from '../domain/planning-ops.js'
import { createCalendarBlock, updateCalendarBlock } from '../domain/calendar-ops.js'

export function createPlanningHandlers(ctx: Ctx): Pick<Handlers, 'weeklyBudget:set' | 'weeklyBudget:reuseDefaults' | 'fixedWork:create' | 'fixedWork:update' | 'calendar:create' | 'calendar:update'> {
  return {
    'calendar:create': (args) => {
      const result = createCalendarBlock(ctx.store.data, args, ctx.now())
      commitChanges(ctx, { calendarBlocks: result.calendarBlocks })
      return result.block
    },
    'calendar:update': (args) => {
      commitChanges(ctx, { calendarBlocks: updateCalendarBlock(ctx.store.data, args.id, args.patch, ctx.now()) })
      return null
    },
    'weeklyBudget:set': (args) => {
      const result = setWeeklyBudget(ctx.store.data, args.weekStart, args.plan, ctx.now())
      commitChanges(ctx, { weeklyBudgets: result.weeklyBudgets, ...(args.reuseAsDefault ? { weeklyBudgetDefaults: structuredClone(args.plan) } : {}) })
      return result.budget
    },
    'weeklyBudget:reuseDefaults': (args) => {
      const result = reuseWeeklyDefaults(ctx.store.data, args.weekStart, ctx.now())
      commitChanges(ctx, { weeklyBudgets: result.weeklyBudgets })
      return result.budget
    },
    'fixedWork:create': (args) => {
      const result = createFixedWork(ctx.store.data, args, ctx.now())
      commitChanges(ctx, { fixedWork: result.fixedWork })
      return result.work
    },
    'fixedWork:update': (args) => {
      commitChanges(ctx, { fixedWork: updateFixedWork(ctx.store.data, args.id, args.patch, ctx.now()) })
      return null
    },
  }
}

import type { ArgsOf } from '@white-box/contracts'
import type { Ctx } from './ports.js'

export function createGoogleCalendarHandlers(ctx: Ctx) {
  const service = () => {
    if (!ctx.googleCalendar) throw new Error('Google Calendar はこの実行環境で利用できません')
    return ctx.googleCalendar
  }
  return {
    'googleCalendar:configure': (args: ArgsOf<'googleCalendar:configure'>) => { service().configure(args); return null },
    'googleCalendar:connect': async () => { await service().connect(); return null },
    'googleCalendar:cancelConnect': () => { service().cancelConnect(); return null },
    'googleCalendar:disconnect': () => { service().disconnect(); return null },
    'googleCalendar:select': (args: ArgsOf<'googleCalendar:select'>) => { service().select(args.calendarIds); return null },
    'googleCalendar:sync': async (args: ArgsOf<'googleCalendar:sync'>) => { await service().sync(args); return null },
    'googleCalendar:create': (args: ArgsOf<'googleCalendar:create'>) => service().create(args),
  }
}

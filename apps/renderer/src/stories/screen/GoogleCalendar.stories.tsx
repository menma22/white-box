import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { WeekCalendar } from '@/features/today/WeekCalendar'
import { GoogleDayTimeline } from '@/features/google-calendar/GoogleDayTimeline'
import { googleCalendarEvent, type GoogleEvent } from '@/features/google-calendar/google-calendar'
import { dayRange } from '@white-box/core/activity'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
const events: GoogleEvent[] = [
  { id: 'all-day', calendarId: 'main', title: '出張', startedAt: at(12, 0), endedAt: at(14, 0), allDay: true },
  { id: 'meeting', calendarId: 'main', title: 'チームの打ち合わせ', startedAt: at(12, 9), endedAt: at(12, 10), allDay: false },
  { id: 'overlap', calendarId: 'shared', title: '重なる共有カレンダーの予定', startedAt: at(12, 9), endedAt: at(12, 11), allDay: false },
  { id: 'night', calendarId: 'main', title: '日をまたぐ予定', startedAt: at(12, 23), endedAt: at(13, 5), allDay: false },
]
const meta: Meta<typeof WeekCalendar> = { title: 'screen/GoogleCalendar', component: WeekCalendar, parameters: { layout: 'fullscreen' }, args: {
  start: '2026-10-12', today: '2026-10-12', now: at(12, 9), events: events.map(googleCalendarEvent), actualByDay: new Map(), zoom: true,
  onCreate: () => {}, onEvent: () => {},
} }
export default meta
type Story = StoryObj<typeof WeekCalendar>
export const WeekWithGoogle: Story = { render: (args: ComponentProps<typeof WeekCalendar>) => <div style={{ height: '100vh', display: 'flex' }}><WeekCalendar {...args} /></div> }
export const DayWithNoSessions: Story = { render: () => <GoogleDayTimeline events={events} period={dayRange('2026-10-12', 4)} onEvent={() => {}} /> }

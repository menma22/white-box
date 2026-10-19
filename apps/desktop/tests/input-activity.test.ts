import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchInputActivity } from '../src/infra/input-activity.js'

const native = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: native.spawn }))

function helper() {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => { Object.defineProperty(process, 'platform', { value: 'win32' }); native.spawn.mockReset() })
afterEach(() => Object.defineProperty(process, 'platform', platform))

describe('入力活動helperの終了', () => {
  it('分割された整数出力を受け取り、stop後のstdoutとerrorを無視する', () => {
    const child = helper()
    native.spawn.mockReturnValue(child)
    const count = vi.fn(), error = vi.fn()
    const stop = watchInputActivity(count, error)
    child.stdout.emit('data', Buffer.from('1'))
    child.stdout.emit('data', Buffer.from('2\r\n0\ninvalid\n'))
    expect(count.mock.calls).toEqual([[12], [0]])
    stop()
    child.stdout.emit('data', Buffer.from('20\n'))
    child.emit('error', new Error('late error'))
    child.emit('exit', null)
    expect(count).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('helperエラーで停止し、続くexitを二重のエラーとして扱わない', () => {
    const child = helper()
    native.spawn.mockReturnValue(child)
    const count = vi.fn(), error = vi.fn()
    watchInputActivity(count, error)
    child.emit('error', new Error('spawn failed'))
    child.emit('exit', 1)
    child.stdout.emit('data', Buffer.from('30\n'))
    expect(error).toHaveBeenCalledOnce()
    expect(count).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledOnce()
  })
})

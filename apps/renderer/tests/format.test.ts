/**
 * 未割り当てのショートカット（空文字）の表記を固定する。
 * 既定のショートカットが空になったので、この状態は初回起動時の標準の状態になる。
 */
import { describe, expect, it } from 'vitest'
import { shortcutLabel } from '../src/lib/format.js'

describe('未割り当てのショートカットの表記', () => {
  it('空文字は「未設定」と読める形で返る（空のキー枠を出さないため）', () => {
    expect(shortcutLabel('')).toBe('未設定')
  })
})

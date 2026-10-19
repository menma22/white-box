function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let seq = 0
    const pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    })
    const disconnected = () => {
      const cause = new Error('CDP connection closed')
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(cause) }
      pending.clear()
      reject(cause)
    }
    ws.addEventListener('error', disconnected)
    ws.addEventListener('close', disconnected)
    ws.addEventListener('open', () =>
      resolve({
        close: () => ws.close(),
        async evaluate(expression) {
          const id = ++seq
          const result = await new Promise((res, rej) => {
            if (ws.readyState !== WebSocket.OPEN) { rej(new Error('CDP connection closed')); return }
            const timer = setTimeout(() => { pending.delete(id); rej(new Error('CDP request timed out')) }, 10_000)
            pending.set(id, { resolve: res, reject: rej, timer })
            ws.send(
              JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: { expression, awaitPromise: true, returnByValue: true },
              }),
            )
          })
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
          return result.result.value
        },
      }),
    )
  })
}

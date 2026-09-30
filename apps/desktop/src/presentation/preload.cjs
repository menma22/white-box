// レンダラへの唯一の窓口。ここで公開していない機能はレンダラから触れない。
// package.json が type:module なので、この preload は .cjs のまま置くこと（.js にすると読み込みに失敗する）。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whitebox', {
  call: (name, args) => ipcRenderer.invoke('whitebox:cmd', { name, args }),
  onState: (cb) => {
    const handler = (_e, state) => cb(state)
    ipcRenderer.on('whitebox:state', handler)
    return () => ipcRenderer.removeListener('whitebox:state', handler)
  },
  onTick: (cb) => {
    const handler = (_e, tick) => cb(tick)
    ipcRenderer.on('whitebox:tick', handler)
    return () => ipcRenderer.removeListener('whitebox:tick', handler)
  },
  onSignal: (cb) => {
    const handler = (_e, signal) => cb(signal)
    ipcRenderer.on('whitebox:signal', handler)
    return () => ipcRenderer.removeListener('whitebox:signal', handler)
  },
  windowKind: () => location.hash.replace('#', '') || 'main',
})

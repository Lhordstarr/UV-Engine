import { useEffect, useState, useRef } from 'react'
import api from '../api'

function loadBand(pct) {
  if (pct === null || pct === undefined) return 'none'
  if (pct >= 85) return 'high'
  if (pct >= 60) return 'warn'
  return 'ok'
}
function fmtMB(mb) {
  if (typeof mb !== 'number') return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}
const bandColor = { ok: 'bg-emerald-400', warn: 'bg-amber-400', high: 'bg-red-400', none: 'bg-white/10' }

export default function Resources() {
  const [r, setR] = useState(null)
  const [stamp, setStamp] = useState('')
  const busy = useRef(false)

  useEffect(() => {
    let timer
    const poll = async () => {
      if (busy.current) return
      busy.current = true
      try {
        const res = await api.get('/resources')
        setR(res.data.resources)
        const d = new Date(res.data.resources.at)
        setStamp(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`)
      } catch {
        setStamp('offline')
      } finally { busy.current = false }
    }
    poll()
    timer = setInterval(poll, 1000)
    return () => clearInterval(timer)
  }, [])

  if (!r) return <div className="text-xs text-white/40">Loading resources…</div>

  const cpuPct = r.cpu.percent
  const gpuAvail = r.gpu.available

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">Resources</span>
        <span className="text-[10px] text-white/40 font-mono">{stamp}</span>
      </div>
      <Meter label="CPU" text={cpuPct === null ? `load ${r.cpu.loadAvg1}` : `${cpuPct}%`} pct={cpuPct} band={cpuPct === null ? null : loadBand(cpuPct)} />
      <Meter label="RAM" text={`${fmtMB(r.ram.usedMB)} / ${fmtMB(r.ram.totalMB)}`} pct={r.ram.percent} band={loadBand(r.ram.percent)} />
      {gpuAvail ? (
        <>
          <Meter label="GPU" text={r.gpu.percent === null ? (r.gpu.reason ? 'no counters' : 'idle') : `${r.gpu.percent}%`} pct={r.gpu.percent} band={r.gpu.percent === null ? null : loadBand(r.gpu.percent)} title={[r.gpu.vendor==='amd'?'AMD':r.gpu.vendor==='nvidia'?'NVIDIA':r.gpu.vendor==='intel'?'Intel':'', r.gpu.name, r.gpu.reason].filter(Boolean).join(' · ')} />
          <div className="flex items-center justify-between text-xs pl-1">
            <span className="text-white/50">VRAM</span>
            <span className="text-white/70">{(() => {
              const used = r.gpu.memUsedMB; const total = r.gpu.memTotalMB
              const hasTotal = typeof used === 'number' && typeof total === 'number' && total > 0
              return hasTotal ? `${fmtMB(used)} / ${fmtMB(total)}` : (typeof used === 'number' ? fmtMB(used) : '—')
            })()}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            {(() => {
              const used = r.gpu.memUsedMB; const total = r.gpu.memTotalMB
              const hasTotal = typeof used === 'number' && typeof total === 'number' && total > 0
              const pct = hasTotal ? (used/total)*100 : 0
              return <div className={`h-full ${bandColor[loadBand(pct)] || 'bg-violet-400'} transition-all`} style={{width: `${Math.min(100,Math.max(0,pct))}%`}}/>
            })()}
          </div>
        </>
      ) : (
        <>
          <Meter label="GPU" text="none" pct={null} band={null} title={r.gpu.reason || 'No GPU detected'} />
          <div className="flex items-center justify-between text-xs pl-1">
            <span className="text-white/50">VRAM</span>
            <span className="text-white/40">none</span>
          </div>
        </>
      )}
    </div>
  )
}

function Meter({ label, text, pct, band, title }) {
  const width = pct === null ? '0%' : `${Math.min(100, Math.max(0, pct))}%`
  return (
    <div className="flex items-center gap-3" title={title}>
      <span className="text-xs text-white/50 w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${bandColor[band] || 'bg-white/10'} transition-all`} style={{width}}/>
      </div>
      <span className="text-xs text-white/70 w-24 text-right truncate">{text}</span>
    </div>
  )
}


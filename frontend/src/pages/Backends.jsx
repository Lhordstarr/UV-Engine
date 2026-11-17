import { useEffect, useState } from 'react'
import { Cpu, CheckCircle2, XCircle, AlertCircle, Power } from 'lucide-react'
import api from '../api'
import { toggleBackend } from '../api'

const deviceColor = { gpu: 'bg-white/15 text-white', cpu: 'bg-white/15 text-white', none: 'bg-red-500/15 text-red-400', hybrid: 'bg-white/15 text-white', unknown: 'bg-white/10 text-white/50' }

export default function Backends() {
  const [data, setData] = useState(null)
  const [install, setInstall] = useState(null)
  const [toggling, setToggling] = useState(null)
  const refreshBackends = () => api.get('/backends').then(r=>setData(r.data)).catch(()=>{})
  const handleToggle = async (b) => {
    setToggling(b.id)
    try { await toggleBackend(b.id, !b.enabled); await refreshBackends() } catch(e) {}
    setToggling(null)
  }
  useEffect(()=>{ refreshBackends(); api.get('/backends/install-ml/status').then(r=>setInstall(r.data)).catch(()=>{}) }, [])

  const startInstall = async () => {
    try {
      const r = await api.post('/backends/install-ml')
      setInstall(r.data)
      pollInstall()
    } catch(e){ alert('Failed to start install') }
  }
  const pollInstall = () => {
    const t = setInterval(async ()=>{
      try {
        const r = await api.get('/backends/install-ml/status')
        setInstall(r.data)
        if (r.data.status === 'done' || r.data.status === 'error') {
          clearInterval(t)
          refreshBackends()
        }
      } catch(e){ clearInterval(t) }
    }, 1500)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white bg-clip-text text-transparent">Backends</h1>
        <p className="text-white/50 mt-1">Execution backends: what is installed and what device it runs on.</p>
      </header>

      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Auto-install ML backend</div>
            <div className="text-xs text-white/40 mt-0.5">Downloads torch + diffusers (may take several minutes). GPU wheels depend on your platform.</div>
          </div>
          <button onClick={startInstall} disabled={install?.status==='running'}
            className="px-4 py-2 rounded-lg bg-white/80 hover:bg-white text-black text-sm font-medium transition disabled:opacity-40">
            {install?.status==='running' ? 'Installing…' : 'Install ML backend'}
          </button>
        </div>
        {install && install.status !== 'idle' && (
          <div className="mt-3">
            <div className="text-xs text-white/50 mb-1">Status: {install.status} {install.hardware && `· hardware: ${install.hardware}`} {install.variant && `· variant: ${install.variant}`}</div>
            <pre className="max-h-40 overflow-y-auto p-3 rounded-lg bg-black/40 text-[10px] text-white/60 font-mono">{(install.log_tail||[]).join('\n')}</pre>
          </div>
        )}
      </div>

      {!data ? <div className="text-white/40">Loading…</div> : (
        <div className="space-y-3">
          {data.backends.map(b=>(
            <div key={b.id} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Cpu className="w-5 h-5 text-white"/>
                  <div>
                    <div className="font-semibold">{b.label}</div>
                    <div className="text-xs text-white/40 mt-0.5">{b.detail}</div>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${deviceColor[b.device]||'bg-white/10'}`}>{b.device}</span>
                <button onClick={()=>handleToggle(b)} disabled={toggling===b.id}
                  className={`ml-2 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition ${b.enabled?'bg-white/15 text-white hover:bg-white/25':'bg-white/10 text-white/40 hover:bg-white/15'} disabled:opacity-40`}
                  title={b.enabled?'Enabled - click to disable':'Disabled - click to enable'}>
                  <Power className="w-3 h-3"/>{b.enabled?'On':'Off'}
                </button>
              </div>
              <div className="mt-3 text-xs text-white/40">
                <div><span className="text-white/60">Optional:</span> {b.optional ? 'yes' : 'no'} · <span className="text-white/60">Meets requirements:</span> {b.meets_requirements ? 'yes' : 'no'} · {b.requirements?.join(', ')}</div>
                <div><span className="text-white/60">Enabled:</span> {b.enabled ? 'yes' : 'no'} · <span className="text-white/60">Optional:</span> {b.optional ? 'yes' : 'no'} · <span className="text-white/60">Meets requirements:</span> {b.meets_requirements ? 'yes' : 'no'}</div>
                <div className="mt-1 font-mono break-all"><span className="text-white/60">evidence:</span> {b.evidence}</div>
              </div>
              {b.meta && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-white/40">Raw metadata</summary>
                  <pre className="mt-2 p-3 rounded-lg bg-black/40 overflow-x-auto text-[10px] text-white/60">{JSON.stringify(b.meta, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {data?.torch && (
        <div className="glass rounded-2xl p-6">
          <h2 className="font-semibold mb-3">Torch details</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-white/50">Version</div><div>{data.torch.version || '—'}</div>
            <div className="text-white/50">CUDA</div><div>{String(data.torch.cuda)}</div>
            <div className="text-white/50">ROCm</div><div>{String(data.torch.rocm)}</div>
            <div className="text-white/50">MPS</div><div>{String(data.torch.mps)}</div>
            <div className="text-white/50">Device</div><div>{data.torch.deviceName || data.torch.device}</div>
          </div>
        </div>
      )}
    </div>
  )
}

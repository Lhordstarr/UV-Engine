import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Cpu, Filter } from 'lucide-react'
import { getModels, getHardware, postTelemetry } from '../api'

export default function Models() {
  const [models, setModels] = useState([])
  const [hw, setHw] = useState(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [maxVram, setMaxVram] = useState('')

  const load = () => {
    getModels({ q: q || undefined, type: type || undefined, vram: maxVram || undefined }).then(d=>setModels(d.models||[]))
  }
  useEffect(()=>{ getHardware().then(setHw); load() }, [])
  useEffect(()=>{ load() }, [q, type, maxVram])

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Model Catalog</h1>
        <p className="text-white/50 mt-1">Browse AI video models with VRAM estimates. {hw && `Your VRAM: ${hw.total_vram_gb} GB`}</p>
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search models…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-violet-500 outline-none text-sm"/>
        </div>
        <select value={type} onChange={e=>setType(e.target.value)} className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm">
          <option value="">All types</option>
          <option value="t2v">Text-to-Video</option>
          <option value="i2v">Image-to-Video</option>
        </select>
        <select value={maxVram} onChange={e=>setMaxVram(e.target.value)} className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm">
          <option value="">Any VRAM</option>
          <option value="6">≤ 6 GB</option>
          <option value="8">≤ 8 GB</option>
          <option value="12">≤ 12 GB</option>
          <option value="16">≤ 16 GB</option>
          <option value="24">≤ 24 GB</option>
          <option value="48">≤ 48 GB</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {models.map(m=>(
          <div key={m.id} className="glass rounded-2xl p-5 flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-white/40 mt-0.5">{m.family} · {m.params_b}B params</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${m.fits?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400'}`}>
                {m.fits ? 'Fits' : 'No fit'}
              </span>
            </div>
            <p className="text-sm text-white/60 mt-3 flex-1">{m.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-white/40">VRAM est.</div>
                <div className="font-semibold text-violet-300">{m.vram_estimate_gb} GB</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-white/40">Default</div>
                <div className="font-semibold">{m.default_resolution[0]}×{m.default_resolution[1]}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {m.tags.map(t=>(<span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/50">{t}</span>))}
            </div>
            <div className="mt-4 flex gap-2">
              <Link to={`/generate?model=${m.id}`} className="flex-1 text-center px-3 py-2 rounded-lg bg-violet-600/80 hover:bg-violet-600 text-sm font-medium transition">Use</Link>
              <a href={m.download_url} target="_blank" rel="noreferrer" onClick={()=>postTelemetry('model_download_clicked',{model_id:m.id})}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition" title="Download model weights">⬇</a>
            </div>
          </div>
        ))}
      </div>
      {models.length===0 && <div className="text-center text-white/40 py-12">No models match.</div>}
    </div>
  )
}

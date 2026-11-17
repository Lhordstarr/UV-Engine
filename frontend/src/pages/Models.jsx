import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, Cpu, Filter, Download, Loader2, CheckCircle2, Pause, Play } from 'lucide-react'
import { getModels, getHardware, postTelemetry, downloadModel, pauseModelDownload, listModelDownloads } from '../api'

function fmtBytes(b) {
  if (typeof b !== 'number' || !isFinite(b)) return '—'
  if (b >= 1024 ** 3) return `${(b/1024**3).toFixed(2)} GB`
  if (b >= 1024 ** 2) return `${(b/1024**2).toFixed(1)} MB`
  if (b >= 1024) return `${(b/1024).toFixed(1)} KB`
  return `${b} B`
}
export default function Models() {
  const [models, setModels] = useState([])
  const [hw, setHw] = useState(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [maxVram, setMaxVram] = useState('')
  const [dlStatus, setDlStatus] = useState({})
  const pollRef = useRef(null)

  const load = () => {
    getModels({ q: q || undefined, type: type || undefined, vram: maxVram || undefined }).then(d=>setModels(d.models||[]))
  }
  const refreshDl = () => listModelDownloads().then(d=>{
    const map = {}
    for (const s of (d.downloads||[])) map[s.model_id] = s
    setDlStatus(map)
  }).catch(()=>{})
  useEffect(()=>{ getHardware().then(setHw); load(); refreshDl() }, [])
  useEffect(()=>{ load() }, [q, type, maxVram])
  useEffect(()=>{
    pollRef.current = setInterval(refreshDl, 2000)
    return ()=>{ if(pollRef.current) clearInterval(pollRef.current) }
  }, [])

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white bg-clip-text text-transparent">Model Catalog</h1>
        <p className="text-white/50 mt-1">Browse AI video models with VRAM estimates. {hw && `Your VRAM: ${hw.total_vram_gb} GB`}</p>
      </header>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search models…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-white outline-none text-sm"/>
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
              <div className="flex flex-col items-end gap-1">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${m.type==='t2v'?'bg-white text-black':'bg-white/20 text-white'}`}>
                  {m.type==='t2v' ? 'TEXT → VIDEO' : 'IMAGE → VIDEO'}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${m.fits?'bg-white/15 text-white':'bg-red-500/15 text-red-400'}`}>
                  {m.fits ? 'Fits VRAM' : 'No fit'}
                </span>
                <span className={`text-xs px-2 py-1 rounded-full ${m.supports_real_generation?'bg-white/15 text-white':'bg-white/5 text-white/40'}`}>
                  {m.supports_real_generation ? '✓ Real gen' : '× No real gen'}
                </span>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-white/50">
              {m.type==='t2v' ? 'Generates video from a text prompt.' : 'Animates an uploaded image into a video (requires input image).'}
            </div>
            <p className="text-sm text-white/60 mt-3 flex-1">{m.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-white/40">VRAM est.</div>
                <div className="font-semibold text-white">{m.vram_estimate_gb} GB</div>
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
              <Link to={`/generate?model=${m.id}`} className="flex-1 text-center px-3 py-2 rounded-lg bg-white/80 hover:bg-white text-black text-sm font-medium transition">Use</Link>
              <button onClick={async ()=>{ try { await downloadModel(m.id); refreshDl(); postTelemetry('model_download_started',{model_id:m.id}) } catch(e){} }}
                disabled={dlStatus[m.id]?.status==='running' || dlStatus[m.id]?.status==='queued' || dlStatus[m.id]?.status==='paused'}
                className="px-3 py-2 rounded-lg bg-white/80 hover:bg-white text-black text-sm font-medium transition disabled:opacity-40 flex items-center gap-1" title="Download model weights to server">
                {dlStatus[m.id]?.status==='running' || dlStatus[m.id]?.status==='queued' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4"/>}
              </button>
              {(dlStatus[m.id]?.status==='running' || dlStatus[m.id]?.status==='paused') && (
                <button onClick={async ()=>{ try { await pauseModelDownload(m.id); refreshDl() } catch(e){} }}
                  className="px-3 py-2 rounded-lg bg-white/80 hover:bg-white text-black text-sm font-medium transition flex items-center gap-1" title="Pause/resume download">
                  {dlStatus[m.id]?.status==='paused' ? <Play className="w-4 h-4"/> : <Pause className="w-4 h-4"/>}
                </button>
              )}
              <a href={m.download_url} target="_blank" rel="noreferrer" onClick={()=>postTelemetry('model_download_clicked',{model_id:m.id})}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition" title="Open on HuggingFace">⬇</a>
            </div>
            {dlStatus[m.id] && dlStatus[m.id].status !== 'idle' && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10px] text-white/50 mb-1">
                  <span className="truncate">{dlStatus[m.id].status === 'done' ? 'Downloaded' : (dlStatus[m.id].current_file || dlStatus[m.id].stage)}</span>
                  <span>{Number(dlStatus[m.id].progress||0).toFixed(1)}%{dlStatus[m.id].total_bytes ? ` · ${fmtBytes(dlStatus[m.id].downloaded_bytes||0)} / ${fmtBytes(dlStatus[m.id].total_bytes)}` : ''}</span>
                </div>
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full transition-all ${dlStatus[m.id].status==='done'?'bg-white':dlStatus[m.id].status==='error'?'bg-red-400':'bg-white'}`}
                    style={{width: `${Math.min(100, dlStatus[m.id].progress||0)}%`}}/>
                </div>
                {dlStatus[m.id].error && <div className="text-[10px] text-red-400 mt-1">{dlStatus[m.id].error}</div>}
                {dlStatus[m.id].status==='done' && <div className="text-[10px] text-white mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> {dlStatus[m.id].path}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      {models.length===0 && <div className="text-center text-white/40 py-12">No models match.</div>}
    </div>
  )
}

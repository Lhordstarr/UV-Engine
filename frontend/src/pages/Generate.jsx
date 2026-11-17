import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Play, Download, Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { getModels, generate, getJob, uploadImage, estimate, getTelemetryStats, postTelemetry } from '../api'
import api from '../api'
import Resources from '../components/Resources'

const RESOLUTIONS = [
  { label: '512 × 512', w: 512, h: 512 },
  { label: '720 × 480', w: 720, h: 480 },
  { label: '832 × 480', w: 832, h: 480 },
  { label: '1024 × 576', w: 1024, h: 576 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: 'Custom', w: null, h: null },
]

export default function Generate() {
  const [params] = useSearchParams()
  const [models, setModels] = useState([])
  const [modelId, setModelId] = useState(params.get('model') || '')
  const [prompt, setPrompt] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [resolutionPreset, setResolutionPreset] = useState('Custom')
  const applyResolution = (label) => {
    setResolutionPreset(label)
    const r = RESOLUTIONS.find(x=>x.label===label)
    if (r && r.w) { setWidth(r.w); setHeight(r.h) }
  }
  const [frames, setFrames] = useState('')
  const [fps, setFps] = useState('')
  const [steps, setSteps] = useState(25)
  const [seed, setSeed] = useState('')
  // demo mode removed; real generation is always attempted
  const [imagePath, setImagePath] = useState(null)
  const [imageName, setImageName] = useState('')
  const [vramEst, setVramEst] = useState(null)
  const [stats, setStats] = useState(null)
  const refreshStats = () => getTelemetryStats().then(setStats).catch(()=>{})
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const [backends, setBackends] = useState(null)
  const pollRef = useRef(null)

  useEffect(()=>{ getModels().then(d=>{ setModels(d.models||[]); if(!modelId && d.models?.length) setModelId(d.models[0].id) }); refreshStats(); api.get('/backends').then(r=>setBackends(r.data)).catch(()=>{}) }, [])

  const diffusersBackend = backends?.backends?.find(b=>b.id==='diffusers')
  const realGenAvailable = !!(backends?.torch?.installed && diffusersBackend && diffusersBackend.device !== 'none')
  const realGenReason = !backends ? 'Checking…' :
    !backends.torch?.installed ? 'PyTorch not installed' :
    diffusersBackend?.device === 'none' ? 'diffusers not installed' :
    backends.torch?.device === 'gpu' ? 'Available (GPU)' :
    'Available (CPU - slow)'

  const model = models.find(m=>m.id===modelId)

  useEffect(()=>{
    if(model){
      const w = model.default_resolution[0]
      const h = model.default_resolution[1]
      if(!width) setWidth(w)
      if(!height) setHeight(h)
      if(!frames) setFrames(model.default_frames)
      if(!fps) setFps(model.default_fps)
      const match = RESOLUTIONS.find(r=>r.w===w && r.h===h)
      if (match) setResolutionPreset(match.label)
      else setResolutionPreset('Custom')
    }
  }, [model])

  const handleImage = async (e) => {
    const f = e.target.files?.[0]
    if(!f) return
    try { const r = await uploadImage(f); setImagePath(r.path); setImageName(f.name) } catch(err){ setError('Upload failed') }
  }

  const submit = async () => {
    setError(null); setJob(null)
    try {
      const r = await generate({
        prompt, model_id: modelId,
        width: width ? +width : null,
        height: height ? +height : null,
        num_frames: frames ? +frames : null,
        fps: fps ? +fps : null,
        steps: steps ? +steps : null,
        seed: seed ? +seed : null,
        input_image: imagePath,
      })
      setJob({ id: r.job_id, status: r.status, progress: 0, stage: 'Queued', logs: [] })
      postTelemetry('generate_clicked', { model_id: modelId })
      startPoll(r.job_id)
      setTimeout(refreshStats, 500)
    } catch(e){ setError(e?.response?.data?.detail || e.message) }
  }

  const startPoll = (id) => {
    if(pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async ()=>{
      try {
        const j = await getJob(id)
        setJob(j)
        if(j.status==='done' || j.status==='error' || j.status==='cancelled'){
          clearInterval(pollRef.current); pollRef.current=null
          refreshStats()
          if(j.status==='done') postTelemetry('video_downloaded_view', { job_id: j.id })
        }
      } catch(e){}
    }, 1000)
  }

  useEffect(()=>{
    if(!modelId) return
    const w = width?+width:(model?.default_resolution?.[0]||512)
    const h = height?+height:(model?.default_resolution?.[1]||512)
    const f = frames?+frames:(model?.default_frames||16)
    estimate({ model_id: modelId, width: w, height: h, num_frames: f }).then(r=>setVramEst(r.vram_gb)).catch(()=>setVramEst(null))
  }, [modelId, width, height, frames])
  useEffect(()=>()=>{ if(pollRef.current) clearInterval(pollRef.current) }, [])

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white bg-clip-text text-transparent">Generate Video</h1>
        <p className="text-white/50 mt-1">Compose a prompt and pick a model. VRAM estimate shown per model.</p>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="glass rounded-2xl p-5 space-y-4">
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">Prompt</label>
              <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4}
                placeholder="A cinematic shot of a futuristic city at sunset, flying cars, neon lights…"
                className="mt-2 w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-white outline-none text-sm resize-none"/>
            </div>

            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">Model</label>
              <select value={modelId} onChange={e=>{setModelId(e.target.value); setResolutionPreset('Custom'); setWidth('');setHeight('');setFrames('');setFps('')}}
                className="mt-2 w-full px-4 py-2.5 rounded-xl bg-black border border-white/20 text-white text-sm">
                {models.map(m=>(<option key={m.id} value={m.id} className="bg-black text-white">[{m.type==='t2v'?'T2V':'I2V'}] {m.name} — {m.vram_estimate_gb} GB{m.downloaded ? '  ✓' : ''}{m.supports_real_generation ? '  (runnable)' : '  (not runnable)'}</option>))}
              </select>
              <div className="mt-1 text-[11px] text-white/40">
                T2V = text-to-video. I2V = image-to-video (upload an image below). ✓ = weights downloaded. (runnable) = can run real generation here.
              </div>
            </div>

            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">Resolution</label>
              <select value={resolutionPreset} onChange={e=>applyResolution(e.target.value)}
                className="mt-2 w-full px-4 py-2.5 rounded-xl bg-black border border-white/20 text-white text-sm">
                {RESOLUTIONS.map(r=>(<option key={r.label} value={r.label} className="bg-black text-white">{r.label}</option>))}
              </select>
            </div>
            {resolutionPreset === 'Custom' && (
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Width" value={width} onChange={setWidth}/>
                <NumField label="Height" value={height} onChange={setHeight}/>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="Frames" value={frames} onChange={setFrames}/>
              <NumField label="FPS" value={fps} onChange={setFps}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Steps" value={steps} onChange={setSteps}/>
              <NumField label="Seed (optional)" value={seed} onChange={setSeed}/>
            </div>

            {model?.type==='i2v' && (
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wide">Input image (optional)</label>
                <label className="mt-2 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-dashed border-white/20 cursor-pointer hover:bg-white/10 transition">
                  <Upload className="w-4 h-4 text-white/50"/>
                  <span className="text-sm text-white/60">{imageName || 'Choose image…'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImage}/>
                </label>
              </div>
            )}


            {!realGenAvailable && (
              <div className="text-xs text-white/40">
                Real generation is unavailable (missing PyTorch/diffusers). Run `./start.sh` on a GPU machine, or install ML deps with `uv sync --extra ml`. (Demo mode removed.)
              </div>
            )}
            {model && model.supports_real_generation === false && (
              <div className="text-xs text-white/40">
                This model uses a custom format that this app cannot run directly. Pick a "runnable" model (e.g. cogvideox-2b, ltx-video, animatediff) for real generation.
              </div>
            )}
            {realGenAvailable && backends?.torch?.device !== 'gpu' && (
              <div className="text-xs text-white/80">
                CPU mode: real generation works but is very slow and memory-heavy.
              </div>
            )}

            <button onClick={submit} disabled={!prompt.trim() || !modelId}
              className="w-full py-3 rounded-xl bg-black border-2 border-white text-white font-semibold hover:bg-white hover:text-black transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <Play className="w-4 h-4"/> Generate
            </button>
            {error && <div className="text-sm text-red-400 flex items-center gap-2"><AlertCircle className="w-4 h-4"/>{error}</div>}
          </div>
        </div>

        <div className="space-y-5">
          <div className="glass rounded-2xl p-5">
            <h3 className="font-semibold mb-3">Model info</h3>
            {model ? (
              <div className="space-y-2 text-sm">
                <Row label="Family" value={model.family}/>
                <Row label="Type" value={model.type==='t2v'?'Text→Video':'Image→Video'}/>
                <Row label="Params" value={`${model.params_b}B`}/>
                <Row label="VRAM est. (default)" value={`${model.vram_estimate_gb} GB`} accent/>
                <Row label="VRAM est. (current)" value={vramEst ? `${vramEst} GB` : '…'} accent/>
                <Row label="Fits hardware" value={model.fits ? 'Yes' : 'No'} color={model.fits?'text-white':'text-red-400'}/>
                <Row label="License" value={model.license}/>
              </div>
            ) : <div className="text-white/40 text-sm">Select a model</div>}
          </div>

          {job && (
            <div className="glass rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Job {job.id}</h3>
                <StatusBadge status={job.status}/>
              </div>
              <div className="text-xs text-white/50">{job.stage}</div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-white to-white transition-all" style={{width: `${job.progress||0}%`}}/>
              </div>
              <div className="text-xs text-white/40">{job.progress||0}%</div>
              {job.status==='done' && job.video_path && (
                <div className="space-y-2">
                  <video src={`/api/videos/${job.video_path.split('/').pop()}`} controls className="w-full rounded-lg" />
                  <a href={`/api/videos/${job.video_path.split('/').pop()}`} download
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-white/80 hover:bg-white text-black text-sm font-medium transition">
                    <Download className="w-4 h-4"/> Download
                  </a>
                </div>
              )}
              {job.status==='error' && <div className="text-xs text-red-400">{job.error}</div>}
              {job.real_generation_error && (
                <div className="text-xs text-white">Real generation unavailable: {job.real_generation_error}</div>
              )}
              {job.logs?.length>0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-white/40">Logs</summary>
                  <div className="mt-2 max-h-32 overflow-y-auto font-mono text-[10px] text-white/50 space-y-0.5">
                    {job.logs.map((l,i)=><div key={i}>{l.msg}</div>)}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="glass rounded-2xl p-5">
            <Resources/>
          </div>

          <div className="glass rounded-2xl p-5">
            <h3 className="font-semibold mb-3">Telemetry</h3>
            {stats ? (
              <div className="space-y-2 text-sm">
                <Row label="Total events" value={stats.total_events}/>
                <Row label="Generations" value={stats.counts?.generate_submitted || 0}/>
                <Row label="Completed" value={stats.counts?.generation_completed || 0}/>
                <Row label="Failed" value={stats.counts?.generation_failed || 0}/>
                <Row label="Model downloads" value={stats.counts?.model_download_clicked || 0}/>
                {Object.keys(stats.model_usage||{}).length>0 && (
                  <div className="mt-3">
                    <div className="text-xs text-white/50 mb-1">Top models</div>
                    {Object.entries(stats.model_usage).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>(
                      <div key={k} className="flex items-center justify-between text-xs">
                        <span className="text-white/60 truncate">{k}</span>
                        <span className="text-white">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : <div className="text-white/40 text-sm">Loading…</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function NumField({label, value, onChange}) {
  return (
    <div>
      <label className="text-xs text-white/50 uppercase tracking-wide">{label}</label>
      <input type="number" value={value} onChange={e=>onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-white outline-none text-sm"/>
    </div>
  )
}
function Row({label, value, accent, color}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className={`font-medium ${accent?'text-white':''} ${color||''}`}>{value}</span>
    </div>
  )
}
function StatusBadge({status}) {
  const map = { done:'bg-white/15 text-white', error:'bg-red-500/15 text-red-400', running:'bg-white/15 text-white', queued:'bg-white/10 text-white/50' }
  return <span className={`text-xs px-2 py-1 rounded-full ${map[status]||'bg-white/10'}`}>{status}</span>
}

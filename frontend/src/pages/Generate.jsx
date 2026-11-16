import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Play, Download, Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { getModels, generate, getJob, uploadImage, estimate, getTelemetryStats, postTelemetry } from '../api'
import api from '../api'
import Resources from '../components/Resources'

export default function Generate() {
  const [params] = useSearchParams()
  const [models, setModels] = useState([])
  const [modelId, setModelId] = useState(params.get('model') || '')
  const [prompt, setPrompt] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [frames, setFrames] = useState('')
  const [fps, setFps] = useState('')
  const [steps, setSteps] = useState(25)
  const [seed, setSeed] = useState('')
  const [useReal, setUseReal] = useState(false)
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

  const realGenAvailable = !!(backends?.torch?.installed && backends?.torch?.device === 'gpu' && backends?.backends?.find(b=>b.id==='diffusers')?.meets_requirements !== false && backends?.backends?.find(b=>b.id==='diffusers')?.device !== 'none')
  const realGenReason = !backends ? 'Checking…' :
    !backends.torch?.installed ? 'PyTorch not installed' :
    backends.torch?.device !== 'gpu' ? 'No GPU (CPU-only torch)' :
    backends.backends?.find(b=>b.id==='diffusers')?.device === 'none' ? 'diffusers not installed' :
    'Available'

  const model = models.find(m=>m.id===modelId)

  useEffect(()=>{
    if(model){
      if(!width) setWidth(model.default_resolution[0])
      if(!height) setHeight(model.default_resolution[1])
      if(!frames) setFrames(model.default_frames)
      if(!fps) setFps(model.default_fps)
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
        use_real: useReal,
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
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Generate Video</h1>
        <p className="text-white/50 mt-1">Compose a prompt and pick a model. VRAM estimate shown per model.</p>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="glass rounded-2xl p-5 space-y-4">
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">Prompt</label>
              <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4}
                placeholder="A cinematic shot of a futuristic city at sunset, flying cars, neon lights…"
                className="mt-2 w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-violet-500 outline-none text-sm resize-none"/>
            </div>

            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">Model</label>
              <select value={modelId} onChange={e=>{setModelId(e.target.value); setWidth('');setHeight('');setFrames('');setFps('')}} 
                className="mt-2 w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm">
                {models.map(m=>(<option key={m.id} value={m.id}>{m.name} — {m.vram_estimate_gb} GB</option>))}
              </select>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="Width" value={width} onChange={setWidth}/>
              <NumField label="Height" value={height} onChange={setHeight}/>
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

            <div className="flex items-center gap-3">
              <label className={`flex items-center gap-2 text-sm cursor-pointer ${realGenAvailable?'text-white/60':'text-white/30'}`}>
                <input type="checkbox" checked={useReal} onChange={e=>setUseReal(e.target.checked)} disabled={!realGenAvailable} className="accent-violet-500 disabled:opacity-40"/>
                Attempt real model (requires GPU + diffusers)
              </label>
              <span className={`text-xs ${realGenAvailable?'text-emerald-400':'text-amber-400'}`}>Real gen: {realGenReason}</span>
            </div>
            {!realGenAvailable && (
              <div className="text-xs text-white/40">
                Real generation is unavailable on this machine, so jobs run in demo mode (animated preview). Install ML deps (`uv sync --extra ml`) on a machine with a supported GPU to enable real models.
              </div>
            )}

            <button onClick={submit} disabled={!prompt.trim() || !modelId}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30">
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
                <Row label="Fits hardware" value={model.fits ? 'Yes' : 'No'} color={model.fits?'text-emerald-400':'text-red-400'}/>
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
                <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{width: `${job.progress||0}%`}}/>
              </div>
              <div className="text-xs text-white/40">{job.progress||0}%</div>
              {job.status==='done' && job.video_path && (
                <div className="space-y-2">
                  <video src={`/api/videos/${job.video_path.split('/').pop()}`} controls className="w-full rounded-lg" />
                  <a href={`/api/videos/${job.video_path.split('/').pop()}`} download
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-sm font-medium transition">
                    <Download className="w-4 h-4"/> Download
                  </a>
                </div>
              )}
              {job.status==='error' && <div className="text-xs text-red-400">{job.error}</div>}
              {job.real_generation_error && (
                <div className="text-xs text-amber-400">Real generation unavailable: {job.real_generation_error}</div>
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
                        <span className="text-violet-300">{v}</span>
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
        className="mt-1 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:border-violet-500 outline-none text-sm"/>
    </div>
  )
}
function Row({label, value, accent, color}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className={`font-medium ${accent?'text-violet-300':''} ${color||''}`}>{value}</span>
    </div>
  )
}
function StatusBadge({status}) {
  const map = { done:'bg-emerald-500/15 text-emerald-400', error:'bg-red-500/15 text-red-400', running:'bg-amber-500/15 text-amber-400', queued:'bg-white/10 text-white/50' }
  return <span className={`text-xs px-2 py-1 rounded-full ${map[status]||'bg-white/10'}`}>{status}</span>
}

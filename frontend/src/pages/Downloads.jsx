import { useEffect, useState, useRef } from 'react'
import { Download, Film, Cpu, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react'
import { getModels, getVideos, postTelemetry, downloadModel, listModelDownloads } from '../api'

export default function Downloads() {
  const [models, setModels] = useState([])
  const [videos, setVideos] = useState([])
  const [dlStatus, setDlStatus] = useState({})
  const pollRef = useRef(null)
  useEffect(()=>{
    getModels().then(d=>setModels(d.models||[]))
    getVideos().then(d=>setVideos(d.videos||[]))
    const refresh = ()=>listModelDownloads().then(d=>{const m={};for(const s of (d.downloads||[]))m[s.model_id]=s;setDlStatus(m)}).catch(()=>{})
    refresh()
    pollRef.current = setInterval(refresh, 2000)
    return ()=>{ if(pollRef.current) clearInterval(pollRef.current) }
  }, [])

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Downloads</h1>
        <p className="text-white/50 mt-1">Download model weights and your generated videos.</p>
      </header>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Cpu className="w-4 h-4 text-violet-400"/> Model weights</h2>
        <div className="space-y-2">
          {models.map(m=>{
            const st = dlStatus[m.id]
            return (
            <div key={m.id} className="px-4 py-3 rounded-xl bg-white/5 hover:bg-white/8 transition">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-xs text-white/40">{m.family} · {m.vram_estimate_gb} GB VRAM · {m.type}
                    {m.downloaded && <span className="ml-2 text-emerald-400">· downloaded</span>}
                  </div>
                </div>
                <button onClick={async()=>{ try { await downloadModel(m.id); postTelemetry('model_download_started',{model_id:m.id}) } catch(e){} }}
                  disabled={st?.status==='running' || st?.status==='queued'}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-sm font-medium transition disabled:opacity-40">
                  {st?.status==='running' || st?.status==='queued' ? <Loader2 className="w-4 h-4 animate-spin"/> : (st?.status==='done' ? <CheckCircle2 className="w-4 h-4"/> : <Download className="w-4 h-4"/>)}
                  {st?.status==='running' || st?.status==='queued' ? 'Downloading…' : (st?.status==='done' ? 'Downloaded' : 'Download')}
                </button>
                <a href={m.download_url} target="_blank" rel="noreferrer"
                  onClick={()=>postTelemetry('model_download_clicked',{model_id:m.id})}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition">
                  <ExternalLink className="w-4 h-4"/> HF
                </a>
              </div>
              {st && st.status !== 'idle' && st.status !== 'done' && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-white/50 mb-1">
                    <span className="truncate">{st.current_file || st.stage}</span>
                    <span>{st.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${st.status==='error'?'bg-red-400':'bg-violet-500'}`} style={{width:`${st.progress||0}%`}}/>
                  </div>
                  {st.error && <div className="text-[10px] text-red-400 mt-1">{st.error}</div>}
                </div>
              )}
              {st?.status==='done' && st.path && <div className="mt-1 text-[10px] text-white/40 truncate">{st.path}</div>}
            </div>
            )
          })}
        </div>
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Film className="w-4 h-4 text-cyan-400"/> Generated videos</h2>
        {videos.length===0 ? (
          <div className="text-white/40 text-sm py-6 text-center">No generated videos yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.map(v=>(
              <div key={v.filename} className="rounded-xl bg-white/5 overflow-hidden">
                <video src={v.url} controls className="w-full aspect-video bg-black"/>
                <div className="p-3 space-y-2">
                  <div className="text-sm font-medium truncate">{v.filename}</div>
                  <div className="text-xs text-white/40">{(v.size_bytes/1024/1024).toFixed(2)} MB</div>
                  <a href={v.url} download onClick={()=>postTelemetry('video_downloaded',{filename:v.filename})}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-sm font-medium transition">
                    <Download className="w-4 h-4"/> Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

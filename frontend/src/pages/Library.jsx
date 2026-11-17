import { useEffect, useState } from 'react'
import { Download, Film, Trash2 } from 'lucide-react'
import { getVideos, getJobs, deleteVideo, deleteJob } from '../api'

export default function Library() {
  const [videos, setVideos] = useState([])
  const [jobs, setJobs] = useState([])
  const refresh = () => { getVideos().then(d=>setVideos(d.videos||[])); getJobs().then(d=>setJobs(d.jobs||[])) }
  useEffect(()=>{ refresh() }, [])
  const handleDeleteVideo = async (filename) => {
    if (!confirm('Delete this video?')) return
    try { await deleteVideo(filename); refresh() } catch(e) {}
  }
  const handleDeleteJob = async (id) => {
    if (!confirm('Delete this job?')) return
    try { await deleteJob(id); refresh() } catch(e) {}
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white bg-clip-text text-transparent">Library</h1>
        <p className="text-white/50 mt-1">Your generated videos. Download anytime.</p>
      </header>

      {videos.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-white/40">No videos yet. Generate one to get started.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map(v=>(
            <div key={v.filename} className="glass rounded-2xl overflow-hidden">
              <video src={v.url} controls className="w-full aspect-video bg-black"/>
              <div className="p-4 space-y-2">
                <div className="text-sm font-medium truncate">{v.filename}</div>
                <div className="text-xs text-white/40">{(v.size_bytes/1024/1024).toFixed(2)} MB · {new Date(v.created_at*1000).toLocaleString()}</div>
                <div className="flex gap-2">
                  <a href={v.url} download className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/80 hover:bg-white text-black text-sm font-medium transition">
                    <Download className="w-4 h-4"/> Download
                  </a>
                  <button onClick={()=>handleDeleteVideo(v.filename)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-red-500/30 text-white text-sm transition" title="Delete video">
                    <Trash2 className="w-4 h-4"/>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Job history</h2>
        <div className="space-y-2">
          {jobs.map(j=>(
            <div key={j.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 text-sm">
              <Film className="w-4 h-4 text-white/40"/>
              <div className="flex-1 min-w-0">
                <div className="truncate">{j.params?.prompt}</div>
                <div className="text-xs text-white/40">{j.params?.model_id}</div>
              </div>
              <span className="text-xs text-white/40">{j.status}</span>
              <button onClick={()=>handleDeleteJob(j.id)} className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/30 text-white/60 hover:text-white transition" title="Delete job">
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </div>
          ))}
          {jobs.length===0 && <div className="text-white/40 text-sm">No jobs.</div>}
        </div>
      </section>
    </div>
  )
}

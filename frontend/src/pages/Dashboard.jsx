import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cpu, Film, Play, Zap, HardDrive } from 'lucide-react'
import { getHardware, getJobs, getModels } from '../api'

export default function Dashboard() {
  const [hw, setHw] = useState(null)
  const [jobs, setJobs] = useState([])
  const [models, setModels] = useState([])

  useEffect(() => {
    getHardware().then(setHw).catch(()=>{})
    getJobs().then(d=>setJobs(d.jobs||[])).catch(()=>{})
    getModels().then(d=>setModels(d.models||[])).catch(()=>{})
  }, [])

  const totalVram = hw?.total_vram_gb || 0
  const fitting = models.filter(m=>m.fits).length

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">Dashboard</h1>
          <p className="text-white/50 mt-1">Your local AI video generation studio</p>
        </div>
        <Link to="/generate" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 font-medium hover:opacity-90 transition shadow-lg shadow-violet-500/30 flex items-center gap-2">
          <Play className="w-4 h-4"/> New Generation
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={HardDrive} label="Total VRAM" value={totalVram ? `${totalVram} GB` : '—'} sub={hw?.gpus?.[0]?.name || 'Detecting…'} />
        <StatCard icon={Cpu} label="Models Available" value={models.length} sub={`${fitting} fit your hardware`} />
        <StatCard icon={Film} label="Jobs Run" value={jobs.length} sub="all time" />
        <StatCard icon={Zap} label="Backend" value={hw?.torch_available ? 'GPU' : 'CPU'} sub={hw?.cuda_available ? 'CUDA' : (hw?.mps_available ? 'MPS' : 'demo mode')} />
      </div>

      <section className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Jobs</h2>
          <Link to="/library" className="text-sm text-violet-400 hover:text-violet-300">View all →</Link>
        </div>
        {jobs.length === 0 ? (
          <div className="text-white/40 text-sm py-8 text-center">No jobs yet. Start your first generation.</div>
        ) : (
          <div className="space-y-2">
            {jobs.slice(0,6).map(j=>(
              <div key={j.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/8 transition">
                <div className={`w-2 h-2 rounded-full ${j.status==='done'?'bg-emerald-400':j.status==='error'?'bg-red-400':j.status==='running'?'bg-amber-400 animate-pulse':'bg-white/30'}`}/>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{j.params?.prompt}</div>
                  <div className="text-xs text-white/40">{j.params?.model_id} · {j.status}</div>
                </div>
                <div className="text-xs text-white/40">{j.progress}%</div>
                {j.status==='done' && j.video_path && (
                  <Link to="/library" className="text-xs text-cyan-400">View</Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Quick start</h2>
        <div className="grid md:grid-cols-3 gap-3">
          {models.slice(0,3).map(m=>(
            <Link key={m.id} to={`/generate?model=${m.id}`} className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition border border-white/5">
              <div className="font-medium">{m.name}</div>
              <div className="text-xs text-white/40 mt-1">{m.vram_estimate_gb} GB VRAM · {m.type}</div>
              <div className="text-xs text-emerald-400 mt-2">{m.fits ? 'Fits your hardware' : 'Needs more VRAM'}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({icon:Icon, label, value, sub}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center"><Icon className="w-4 h-4 text-violet-400"/></div>
        <div className="text-xs text-white/50 uppercase tracking-wide">{label}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-white/40 mt-1 truncate">{sub}</div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { HardDrive, Cpu } from 'lucide-react'
import { getHardware, getModels } from '../api'

export default function Settings() {
  const [hw, setHw] = useState(null)
  const [models, setModels] = useState([])
  useEffect(()=>{ getHardware().then(setHw); getModels().then(d=>setModels(d.models||[])) }, [])

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-white bg-clip-text text-transparent">Settings</h1>
        <p className="text-white/50 mt-1">Hardware detection and environment.</p>
      </header>

      <div className="glass rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><HardDrive className="w-4 h-4 text-white"/> Hardware</h2>
        {hw ? (
          <div className="space-y-2 text-sm">
            <Row label="Platform" value={hw.platform}/>
            <Row label="CPU" value={hw.cpu}/>
            <Row label="RAM" value={`${hw.ram_gb} GB`}/>
            <Row label="Total VRAM" value={`${hw.total_vram_gb} GB`} accent/>
            <Row label="Torch" value={hw.torch_available ? (hw.torch_version||'available') : 'not installed'}/>
            <Row label="CUDA" value={hw.cuda_available ? 'yes' : 'no'}/>
            <Row label="MPS" value={hw.mps_available ? 'yes' : 'no'}/>
            <Row label="ROCm" value={hw.rocm_available ? 'yes' : 'no'}/>
          </div>
        ) : <div className="text-white/40 text-sm">Loading…</div>}
        {hw?.gpus?.length>0 && (
          <div className="mt-4">
            <div className="text-xs text-white/50 uppercase mb-2">GPUs</div>
            <div className="space-y-2">
              {hw.gpus.map((g,i)=>(
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 text-sm">
                  <span>{g.name}</span>
                  <span className="text-white">{g.vram_gb} GB · {g.backend}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="glass rounded-2xl p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Cpu className="w-4 h-4 text-white"/> Model fit summary</h2>
        <div className="text-sm text-white/60">
          {models.filter(m=>m.fits).length} of {models.length} models fit your detected VRAM ({hw?.total_vram_gb} GB).
        </div>
        <div className="text-xs text-white/40">
          Real generation requires ML deps (torch + diffusers) and a supported GPU. Install via the Backends tab ("Install ML backend"). Demo mode has been removed.
        </div>
      </div>

      <div className="glass rounded-2xl p-6 space-y-2 text-sm">
        <h2 className="font-semibold mb-2">Paths</h2>
        <Row label="Videos" value="/home/nightmare/StarShip/UV-Engine/data/videos"/>
        <Row label="Jobs" value="/home/nightmare/StarShip/UV-Engine/data/jobs"/>
        <Row label="Uploads" value="/home/nightmare/StarShip/UV-Engine/data/uploads"/>
      </div>
    </div>
  )
}
function Row({label, value, accent}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className={`font-medium ${accent?'text-white':''}`}>{value}</span>
    </div>
  )
}

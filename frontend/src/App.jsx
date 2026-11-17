import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Video, Cpu, Film, Settings as SettingsIcon, Sparkles, HardDrive, Download, Server, Power } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Models from './pages/Models'
import Generate from './pages/Generate'
import Library from './pages/Library'
import Downloads from './pages/Downloads'
import Backends from './pages/Backends'
import Settings from './pages/Settings'

const nav = [
  { to: '/', label: 'Dashboard', icon: Sparkles },
  { to: '/models', label: 'Models', icon: Cpu },
  { to: '/generate', label: 'Generate', icon: Video },
  { to: '/library', label: 'Library', icon: Film },
  { to: '/downloads', label: 'Downloads', icon: Download },
  { to: '/backends', label: 'Backends', icon: Server },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden">
        <aside className="w-60 shrink-0 border-r border-white/5 bg-black/30 backdrop-blur-xl flex flex-col">
          <div className="px-5 py-6 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-white to-white flex items-center justify-center shadow-lg shadow-white/30">
              <Video className="w-5 h-5 text-black" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">UV-Engine</div>
              <div className="text-xs text-white/40">AI Studio</div>
            </div>
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {nav.map(({to,label,icon:Icon}) => (
              <NavLink key={to} to={to} end={to==='/'}
                className={({isActive}) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    isActive ? 'bg-white/10 text-white shadow-inner' : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}>
                <Icon className="w-4 h-4" /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-4 border-t border-white/5 space-y-3">
            <button onClick={async ()=>{ if(confirm('Power off the server?')){ try { await fetch('/api/shutdown',{method:'POST'}) } catch(e){} alert('Server shutting down. You can close this tab.') } }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-sm transition">
              <Power className="w-4 h-4"/> Power off
            </button>
            <div className="text-xs text-white/30 text-center">v1.0 · local-first</div>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto scrollbar">
          <Routes>
            <Route path="/" element={<Dashboard/>}/>
            <Route path="/models" element={<Models/>}/>
            <Route path="/generate" element={<Generate/>}/>
            <Route path="/library" element={<Library/>}/>
            <Route path="/downloads" element={<Downloads/>}/>
            <Route path="/backends" element={<Backends/>}/>
            <Route path="/settings" element={<Settings/>}/>
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

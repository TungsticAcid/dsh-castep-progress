/**
 * CastepProgressPanel.tsx
 * =======================
 * CASTEP 实时进度面板（侧边栏插件打开的居中面板）。
 *
 * 复用 dsh-ssh 插件：通过同源 `/api/dsh-ssh/exec` 在所选服务器上执行
 * **只读**命令（ls / grep / tail），读取任务信息。
 *
 * ★ 任务目录不硬编码：优先读取智能体提交时写入的远程标记
 *    `~/.smartcatai/campaigns.json`（见 src/server/campaign_marker.py），
 *    得到每个服务器的 campaign base；无标记时回退到 `~/xjl/smartcatai_campaign`。
 *
 * ★ 刷新：默认 30 分钟，可在界面里改（持久化到 localStorage），也可手动刷新。
 *
 * 功能：筛选（作业名/状态）、点表头排序、多服务器切换、自动+手动刷新。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

const API = '/api/dsh-ssh/exec'
const DEFAULT_INTERVAL_MIN = 30
const INTERVAL_KEY = 'castep-progress.intervalMin'
const EXTRA_KEY = 'castep-progress.extraBases'
const OPEN_STRUCTURE_EVENT = 'castep-open-structure'

async function exec(alias: string, command: string, timeoutMs = 30000): Promise<string> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, command, timeoutMs }),
  })
  if (!res.ok) throw new Error(`exec ${res.status}`)
  const data = await res.json()
  const result = data?.result ?? {}
  return result.success ? (result.stdout ?? '') : ''
}

interface JobInfo { job: string; tag: string; status: string; ion: number | null; scf: number | null; energy: number | null; remote: string }
const RE_TS = /_\d{8}_\d{4,6}$/

async function readBases(alias: string, user: string): Promise<string[]> {
  const marker = await exec(alias, `cat /home/${user}/.smartcatai/campaigns.json 2>/dev/null`)
  if (!marker) return []
  try {
    const data = JSON.parse(marker)
    if (Array.isArray(data?.[alias]) && data[alias].length) return data[alias]
  } catch { /* ignore malformed marker */ }
  return []
}

async function collectJobs(alias: string, extraBases: string[]): Promise<JobInfo[]> {
  const hostsRes = await fetch('/api/dsh-ssh/hosts')
  const hostsData = await hostsRes.json()
  const user = hostsData.hosts?.find((h: any) => h.alias === alias)?.user || alias
  const bases = [...await readBases(alias, user), ...extraBases.map(b => b.trim()).filter(Boolean)]
  const jobs: JobInfo[] = []

  for (const base of bases) {
    const listing = await exec(alias, `ls -d ${base}/* 2>/dev/null`)
    const dirs = (listing || '').split('\n').map(s => s.trim()).filter(Boolean)
    for (const d of dirs) {
      const tag = d.split('/').pop() || ''
      const job = tag.replace(RE_TS, '')
      const info: JobInfo = { job, tag, status: '?', ion: null, scf: null, energy: null, remote: d }

      const total = await exec(alias, `cd ${d} 2>/dev/null && grep -c 'Total time' ${job}.castep 2>/dev/null`)
      const geom = await exec(alias, `cd ${d} 2>/dev/null && grep -cE 'geometry optimi[sz]ation completed|LBFGS:.*completed' ${job}.castep 2>/dev/null`)
      const nt = (total || '').trim(); const ng = (geom || '').trim()
      if (/^\d+$/.test(nt) && Number(nt) > 0) info.status = 'completed'
      else if (/^\d+$/.test(ng) && Number(ng) > 0) info.status = 'completed'
      else {
        const procs = await exec(alias, "ps aux | grep -c '[c]astepexe'")
        info.status = /^\d+$/.test((procs || '').trim()) && Number(procs) > 0 ? 'running' : 'stopped'
      }

      const init = await exec(alias, `cd ${d} 2>/dev/null && grep -c 'Initial[[:space:]]' ${job}.castep 2>/dev/null`)
      if (/^\d+$/.test((init || '').trim())) info.ion = Number(init.trim())

      const tail = await exec(alias,
        `cd ${d} 2>/dev/null && tail -n 80 ${job}.castep 2>/dev/null | grep -E '^[[:space:]]*[0-9]+[[:space:]].*SCF|Final energy, E|Total time' | tail -5`)
      for (const ln of (tail || '').split('\n')) {
        const m = ln.trim().match(/^(\d+)\s+([-\d.E+]+)/)
        if (m && ln.includes('SCF')) { info.scf = Number(m[1]); info.energy = Number(m[2]) }
        const fe = ln.match(/=\s*([-\d.E+]+)/)
        if (ln.includes('Final energy, E') && fe) info.energy = Number(fe[1])
      }
      jobs.push(info)
    }
  }
  return jobs
}

type SortKey = 'job' | 'status' | 'ion' | 'scf' | 'energy'
const STATUS_COLORS: Record<string, string> = { completed: 'green', running: '#b8860b', error: 'red', stopped: '#8b949e' }

export function CastepProgressPanel(props: { onClose?: () => void; onOpenStructure?: (job: { server: string; job: string; remoteDir: string }) => void }) {
  const { onClose, onOpenStructure } = props
  const [hosts, setHosts] = useState<{ alias: string; user?: string }[]>([])
  const [alias, setAlias] = useState('')
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('job')
  const [asc, setAsc] = useState(true)
  const [error, setError] = useState('')
  const [intervalMin, setIntervalMin] = useState<number>(() => {
    const raw = Number(localStorage.getItem(INTERVAL_KEY))
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MIN
  })
  const [lastRefresh, setLastRefresh] = useState('')
  const [extraBases, setExtraBases] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]'); return Array.isArray(v) ? v.filter(Boolean) : [] }
    catch { return [] }
  })
  const [newBase, setNewBase] = useState('')
  const tickRef = useRef<() => void>(() => {})

  useEffect(() => { localStorage.setItem(INTERVAL_KEY, String(intervalMin)) }, [intervalMin])
  useEffect(() => { localStorage.setItem(EXTRA_KEY, JSON.stringify(extraBases)) }, [extraBases])

  useEffect(() => {
    fetch('/api/dsh-ssh/hosts').then(r => r.json()).then(d => {
      const hs = d.hosts || []
      setHosts(hs)
      if (hs.length) setAlias(a => a || hs[0].alias)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    tickRef.current = async () => {
      if (!alias) return
      try {
        const data = await collectJobs(alias, extraBases)
        setJobs(data); setError(''); setLastRefresh(new Date().toLocaleTimeString())
      } catch (e: any) { setError(String(e?.message ?? e)) }
    }
    if (!alias) return
    tickRef.current()
    const id = setInterval(tickRef.current, intervalMin * 60 * 1000)
    return () => clearInterval(id)
  }, [alias, intervalMin, extraBases])

  const filtered = useMemo(() => {
    let out = jobs.filter(j => !query || j.job.toLowerCase().includes(query.toLowerCase()))
    if (status !== 'all') out = out.filter(j => j.status === status)
    const dir = asc ? 1 : -1
    return [...out].sort((a, b) => {
      const ka = a[sortKey]; const kb = b[sortKey]
      if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir
      return String(ka ?? '').localeCompare(String(kb ?? '')) * dir
    })
  }, [jobs, query, status, sortKey, asc])

  const clickSort = (k: SortKey) => { if (sortKey === k) setAsc(s => !s); else { setSortKey(k); setAsc(true) } }
  const th = (k: SortKey, label: string) => (
    <th onClick={() => clickSort(k)} style={{ cursor: 'pointer' }}>
      {label}{sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div style={{ fontFamily: 'Consolas, monospace', padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>CASTEP 实时进度</h2>
        {onClose && <button onClick={onClose} style={{ marginLeft: 'auto' }}>‹ 返回对话</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input placeholder="筛选作业名…" value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1, minWidth: 120, padding: '4px 6px' }} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="completed">completed</option>
          <option value="running">running</option>
          <option value="stopped">stopped</option>
          <option value="error">error</option>
        </select>
        <select value={alias} onChange={e => setAlias(e.target.value)}>
          {hosts.map(h => <option key={h.alias} value={h.alias}>{h.alias} · {h.user ?? ''}</option>)}
        </select>
        <label>刷新(min) <input type="number" min="1" value={intervalMin} onChange={e => setIntervalMin(Math.max(1, Number(e.target.value) || DEFAULT_INTERVAL_MIN))} style={{ width: 60, padding: '4px 6px' }} /></label>
        <button onClick={() => tickRef.current()}>手动刷新</button>
        <span style={{ opacity: 0.7 }}>{lastRefresh ? `上次 ${lastRefresh}` : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input placeholder="手动添加任务路径（远程绝对路径）" value={newBase} onChange={e => setNewBase(e.target.value)} style={{ flex: 1, minWidth: 160, padding: '4px 6px' }} />
        <button onClick={() => { const b = newBase.trim(); if (b && !extraBases.includes(b)) setExtraBases([...extraBases, b]); setNewBase('') }}>添加路径</button>
      </div>
      {extraBases.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {extraBases.map(b => (
            <span key={b} style={{ display: 'inline-block', margin: '2px 4px', padding: '2px 6px', border: '1px solid #30363d', borderRadius: 4 }}>
              {b} <button onClick={() => setExtraBases(extraBases.filter(x => x !== b))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#f85149' }}>×</button>
            </span>
          ))}
        </div>
      )}
      {error && <div style={{ color: '#f85149' }}>错误: {error}</div>}
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {th('job', '作业')}
            {th('status', '状态')}
            {th('ion', '离子步')}
            {th('scf', 'SCF 步')}
            {th('energy', '能量(eV)')}
            <th>远程目录</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(j => (
            <tr key={j.tag} title="点击查看结构（初始→当前逐帧 + 播放动画）"
                style={{ borderTop: '1px solid #30363d', cursor: 'pointer' }}
                onClick={() => {
                  if (onOpenStructure) onOpenStructure({ server: alias, job: j.job, remoteDir: j.remote })
                  else window.dispatchEvent(new CustomEvent(OPEN_STRUCTURE_EVENT, { detail: { server: alias, job: j.job, remoteDir: j.remote } }))
                }}>
              <td>{j.job}</td>
              <td style={{ color: STATUS_COLORS[j.status] || 'gray' }}>{j.status}</td>
              <td>{j.ion ?? '-'}</td>
              <td>{j.scf ?? '-'}</td>
              <td>{j.energy != null ? j.energy.toFixed(4) : '-'}</td>
              <td style={{ opacity: 0.7 }}>{j.remote}</td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={6} style={{ opacity: 0.7 }}>暂无作业</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/**
 * CastepProgressPanel.tsx
 * =======================
 * CASTEP 实时进度面板（dsh-better-sidebar Tab）。
 *
 * 复用 dsh-ssh 插件：通过同源 `/api/dsh-ssh/exec` 在所选服务器上执行只读命令，
 * 读取任务信息。支持：多服务器选择、开始时间、能量、细化状态、筛选/排序、
 * 手动刷新、文件下载/删除。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

const API = '/api/dsh-ssh/exec'
const DEFAULT_INTERVAL_MIN = 30
const INTERVAL_KEY = 'castep-progress.intervalMin'
const EXTRA_KEY = 'castep-progress.extraBases'

async function exec(alias: string, command: string, timeoutMs = 45000): Promise<string> {
  const res = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, command, timeoutMs }),
  })
  if (!res.ok) throw new Error(`exec ${res.status}`)
  const data = await res.json()
  const r = data?.result ?? {}
  return r.success ? (r.stdout ?? '') : ''
}

interface Host { alias: string; user?: string }
interface JobInfo { job: string; tag: string; server: string; status: string; ion: number | null; scf: number | null; energy: number | null; start: string; startMs: number | null; total: number | null; remote: string }

async function readBases(alias: string, user: string): Promise<string[]> {
  const home = `/home/${user}`
  const bases: string[] = []
  const seen = new Set<string>()
  const add = (p: string) => { const q = p.trim().replace(/\/+$/, ''); if (q && !seen.has(q)) { seen.add(q); bases.push(q) } }

  const marker = await exec(alias, `cat ${home}/.smartcatai/campaigns.json 2>/dev/null`)
  if (marker) {
    try { const d = JSON.parse(marker); const listed = d?.[alias]; if (Array.isArray(listed)) listed.forEach(add) } catch {}
  }

  // 回退：未写 marker 的服务器（如 MS-195）自动发现 smartcatai_campaign 基目录。
  if (bases.length === 0) {
    const found = await exec(alias, `find ${home} -maxdepth 4 -type d -name smartcatai_campaign 2>/dev/null | head -20`)
    if (found) found.split('\n').map(s => s.trim()).filter(Boolean).forEach(add)
  }
  return bases
}

async function fetchJobsForServer(alias: string, user: string, extraBases: string[]): Promise<JobInfo[]> {
  const bases = [...await readBases(alias, user), ...extraBases.map(b => b.trim()).filter(Boolean)]
  const jobs: JobInfo[] = []
  for (const base of bases) {
    const listing = await exec(alias, `ls -d ${base}/* 2>/dev/null`)
    const dirs = (listing || '').split('\n').map(s => s.trim()).filter(Boolean)
    for (const d of dirs) {
      const tag = d.split('/').pop() || ''
      const info: JobInfo = { job: tag, tag, server: alias, status: '?', ion: null, scf: null, energy: null, start: '', startMs: null, total: null, remote: d }

      // 一次性脚本：先取目录内真实 .castep 种子名（目录名常带时间戳/变体后缀），再读状态/能量。
      const script = [
        `cd ${d} || exit 1`,
        `seed=$(ls *.castep 2>/dev/null | head -1)`,
        `seed=\${seed%.castep}`,
        `[ -n "$seed" ] || seed=$(basename "$PWD")`,
        `job=$seed`,
        `has_castep=0; has_total=0; has_geom=0; has_scf=0; has_maxit=0; has_err=0`,
        `[ -f $job.castep ] && has_castep=1`,
        `grep -q 'Total time' $job.castep 2>/dev/null && has_total=1`,
        `grep -qE 'geometry optimi[sz]ation completed|LBFGS:.*completed' $job.castep 2>/dev/null && has_geom=1`,
        `grep -q 'electronic minimisation did not converge' $job.castep 2>/dev/null && has_scf=1`,
        `grep -qiE 'reached.*maximum.*iter|maximum.*iter|iteration limit' $job.castep 2>/dev/null && has_maxit=1`,
        `grep -qiE 'MPI_Abort|Fatal error|error in |error while' $job.castep 2>/dev/null && has_err=1`,
        `mtime=$(stat -c %Y $job.castep 2>/dev/null || echo 0)`,
        `start=$(stat -c %Y $job.param $job.cell $job.castep 2>/dev/null | sort -n | head -1)`,
        `proc=$(ps aux | grep -c "[c]astepexe.*$job" 2>/dev/null || echo 0)`,
        `echo "JOB=$job"`,
        `echo "START=$start"`,
        `echo "S=$has_castep,$has_total,$has_geom,$has_scf,$has_maxit,$has_err,$mtime,$proc"`,
        `grep -E 'Final energy, E|Final Enthalpy' $job.castep 2>/dev/null | tail -1`,
        `tail -n 40 $job.castep 2>/dev/null | grep -E '^[[:space:]]*[0-9]+[[:space:]].*SCF' | tail -1`,
        `grep -E 'Total time' $job.castep 2>/dev/null | tail -1`,
      ].join(';\n')
      const out = await exec(alias, script)
      const lines = (out || '').split('\n')
      const jobLine = lines.find(l => l.startsWith('JOB='))
      if (jobLine) { const j = jobLine.slice(4).trim(); if (j) info.job = j }
      const seed = info.job || tag
      const sig = lines.find(l => l.startsWith('S='))
      let s: Record<string, string> = {}
      if (sig) {
        const v = sig.slice(2).split(',')
        ;['has_castep','has_total','has_geom','has_scf','has_maxit','has_err','mtime','proc'].forEach((k, i) => s[k] = v[i])
      }
      const energyLine = lines.find(l => /Final energy, E|Final Enthalpy/.test(l))
      if (energyLine) { const m = energyLine.match(/=\s*([-\d.E+]+)/); if (m) info.energy = Number(m[1]) }
      const scfLine = lines.filter(l => /--< SCF/.test(l)).pop()
      if (scfLine) { const m = scfLine.trim().match(/^(\d+)\s+([-\d.E+]+)/); if (m) { info.scf = Number(m[1]); if (info.energy == null) info.energy = Number(m[2]) } }
      // 总时间（Total time = 12.34 h / 567.8 s）
      const totalLine = lines.filter(l => /Total time/.test(l)).pop()
      if (totalLine) {
        const m = totalLine.match(/=\s*([\d.]+)\s*([a-z]+)/i)
        if (m) { const v = Number(m[1]); const u = m[2].toLowerCase(); info.total = u.startsWith('h') ? v * 3600 : u.startsWith('m') ? v * 60 : v }
      }
      const ion = await exec(alias, `cd ${d} 2>/dev/null && grep -c 'Initial[[:space:]]' ${seed}.castep 2>/dev/null`)
      if (/^\d+$/.test((ion || '').trim())) info.ion = Number(ion.trim())

      // 状态判定（参考 DRM spinel）
      const now = Math.floor(Date.now() / 1000)
      const mtime = Number(s.mtime || 0)
      const proc = Number(s.proc || 0)
      if (s.has_castep === '0') info.status = 'setup_only'
      else if (s.has_total === '1' || s.has_geom === '1') info.status = 'converged'
      else if (s.has_scf === '1') info.status = 'scf_unconverged'
      else if (s.has_maxit === '1') info.status = 'geom_max_iter'
      else if (s.has_err === '1') info.status = 'error'
      else if (proc > 0) info.status = 'running'
      else if (mtime > 0 && now - mtime > 3600) info.status = 'stopped'
      else info.status = 'running'

      if (mtime > 0) { info.startMs = mtime * 1000; info.start = new Date(mtime * 1000).toLocaleString() }
      const startLine = lines.find(l => l.startsWith('START='))
      const startSec = Number((startLine || '').slice(6).trim())
      if (Number.isFinite(startSec) && startSec > 0) { info.startMs = startSec * 1000; info.start = new Date(startSec * 1000).toLocaleString() }
      jobs.push(info)
    }
  }
  return jobs
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  converged: { label: 'converged', color: 'green' },
  running: { label: 'running', color: '#b8860b' },
  scf_unconverged: { label: 'SCF未收敛', color: '#f85149' },
  geom_max_iter: { label: '达到最大迭代', color: '#f85149' },
  error: { label: 'error', color: '#f85149' },
  terminated: { label: 'terminated', color: '#f85149' },
  stopped: { label: 'stopped', color: '#8b949e' },
  setup_only: { label: 'setup_only', color: '#8b949e' },
}
type SortKey = 'job' | 'server' | 'path' | 'status' | 'ion' | 'scf' | 'energy' | 'start' | 'total'

async function downloadFile(alias: string, path: string, name: string) {
  const res = await fetch(`/api/dsh-ssh/download?alias=${encodeURIComponent(alias)}&path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`download ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

/** 秒 → 人类可读时长。 */
function fmtDuration(sec: number): string {
  if (sec >= 3600) return `${(sec / 3600).toFixed(2)} h`
  if (sec >= 60) return `${(sec / 60).toFixed(1)} min`
  return `${sec.toFixed(0)} s`
}

/** 排序取值：路径列取 remote，开始时间列取 epoch。 */
function sortVal(j: JobInfo, k: SortKey): number | string {
  if (k === 'path') return j.remote
  if (k === 'start') return j.startMs ?? 0
  if (k === 'total') return j.total ?? -1
  const v = (j as any)[k]
  return v == null ? '' : v
}

/** 列定义（可拖拽调宽）。 */
const COLS: { key: SortKey | 'ops'; label: string; w: number }[] = [
  { key: 'job', label: '作业', w: 190 },
  { key: 'server', label: '服务器', w: 80 },
  { key: 'path', label: '路径', w: 260 },
  { key: 'status', label: '状态', w: 100 },
  { key: 'start', label: '开始时间', w: 150 },
  { key: 'ion', label: '离子步', w: 72 },
  { key: 'scf', label: 'SCF 步', w: 72 },
  { key: 'energy', label: '能量(eV)', w: 110 },
  { key: 'total', label: '总时间', w: 90 },
  { key: 'ops', label: '操作', w: 130 },
]

export function CastepProgressPanel(props: { onClose?: () => void; onOpenStructure?: (job: { server: string; job: string; remoteDir: string }) => void }) {
  const { onClose, onOpenStructure } = props
  const [hosts, setHosts] = useState<Host[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('job')
  const [asc, setAsc] = useState(true)
  const [error, setError] = useState('')
  const [intervalMin, setIntervalMin] = useState<number>(() => { const raw = Number(localStorage.getItem(INTERVAL_KEY)); return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MIN })
  const [lastRefresh, setLastRefresh] = useState('')
  const [extraBases, setExtraBases] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]'); return Array.isArray(v) ? v.filter(Boolean) : [] } catch { return [] } })
  const [newBase, setNewBase] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [widths, setWidths] = useState<Record<string, number>>(() => { const o: Record<string, number> = {}; COLS.forEach(c => o[c.key] = c.w); return o })
  const [hBarH, setHBarH] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tickRef = useRef<() => void>(() => {})

  useEffect(() => { localStorage.setItem(INTERVAL_KEY, String(intervalMin)) }, [intervalMin])
  useEffect(() => { localStorage.setItem(EXTRA_KEY, JSON.stringify(extraBases)) }, [extraBases])

  useEffect(() => {
    fetch('/api/dsh-ssh/hosts').then(r => r.json()).then(d => { const hs = d.hosts || []; setHosts(hs); if (hs.length) setSelected(hs.map(h => h.alias)) }).catch(() => {})
  }, [])

  useEffect(() => {
    tickRef.current = async () => {
      setLastRefresh(new Date().toLocaleTimeString())
      if (!selected.length) { setJobs([]); return }
      try {
        const all: JobInfo[] = []
        for (const alias of selected) {
          const user = hosts.find(h => h.alias === alias)?.user || alias
          const js = await fetchJobsForServer(alias, user, extraBases)
          all.push(...js)
        }
        setJobs(all); setError('')
      } catch (e: any) { setError(String(e?.message ?? e)) }
    }
    if (!selected.length) return
    tickRef.current()
    const id = setInterval(tickRef.current, intervalMin * 60 * 1000)
    return () => clearInterval(id)
  }, [selected, intervalMin, extraBases, hosts])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = jobs.filter(j => !q || j.job.toLowerCase().includes(q) || j.tag.toLowerCase().includes(q) || j.remote.toLowerCase().includes(q))
    if (status !== 'all') out = out.filter(j => j.status === status)
    if (fromDate) { const t = new Date(fromDate + 'T00:00:00').getTime(); out = out.filter(j => j.startMs != null && j.startMs >= t) }
    if (toDate) { const t = new Date(toDate + 'T23:59:59').getTime(); out = out.filter(j => j.startMs != null && j.startMs <= t) }
    const dir = asc ? 1 : -1
    return [...out].sort((a, b) => {
      const ka = sortVal(a, sortKey); const kb = sortVal(b, sortKey)
      if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir
      return String(ka).localeCompare(String(kb)) * dir
    })
  }, [jobs, query, status, fromDate, toDate, sortKey, asc])

  const totalPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const curPage = Math.min(page, totalPage)
  const pageRows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize)
  useEffect(() => { setPage(1) }, [query, status, fromDate, toDate, sortKey, asc, pageSize])

  // 横向滚动条会占掉纵向高度：检测到横向溢出时把表格区最大高度补上滚动条厚度，保持行区域高度不变。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const h = el.scrollWidth > el.clientWidth + 1 ? Math.max(0, el.offsetHeight - el.clientHeight) : 0
      setHBarH(prev => (prev === h ? prev : h))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [widths, pageSize, filtered.length])

  const clickSort = (k: SortKey) => { if (sortKey === k) setAsc(s => !s); else { setSortKey(k); setAsc(true) } }

  // 拖拽列边框调宽：同时支持表格超出容器时左右滑动。
  const startResize = (key: string, e: ReactMouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX; const startW = widths[key] ?? 100
    const onMove = (ev: MouseEvent) => { setWidths(w => ({ ...w, [key]: Math.max(48, startW + (ev.clientX - startX)) })) }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); document.body.style.userSelect = '' }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  const th = (c: { key: SortKey | 'ops'; label: string }) => {
    const sortable = c.key !== 'ops'
    const k = c.key as SortKey
    return (
      <th key={c.key} onClick={sortable ? () => clickSort(k) : undefined}
        style={{ cursor: sortable ? 'pointer' : 'default', position: 'relative', width: widths[c.key], padding: '4px 8px 4px 4px', textAlign: 'left', userSelect: 'none' }}>
        {c.label}{sortable && sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}
        <span onMouseDown={e => startResize(c.key, e)} title="拖动调整列宽"
          style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', background: 'rgba(128,128,128,0.25)' }} />
      </th>
    )
  }

  const toggleServer = (alias: string) => setSelected(s => s.includes(alias) ? s.filter(x => x !== alias) : [...s, alias])
  const allSelected = hosts.length > 0 && selected.length === hosts.length
  const totalWidth = COLS.reduce((s, c) => s + (widths[c.key] ?? c.w), 0)

  return (
    <div style={{ fontFamily: 'Consolas, monospace', padding: 8, flex: '1 1 auto', minWidth: 0, minHeight: 0, width: '100%', height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexShrink: 0 }}>
        <h2 style={{ margin: 0 }}>CASTEP 实时进度</h2>
        {onClose && <button onClick={onClose} style={{ marginLeft: 'auto' }}>‹ 返回对话</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <label><input type="checkbox" checked={allSelected} onChange={e => setSelected(e.target.checked ? hosts.map(h => h.alias) : [])} /> 全选服务器</label>
        {hosts.map(h => (
          <label key={h.alias}><input type="checkbox" checked={selected.includes(h.alias)} onChange={() => toggleServer(h.alias)} /> {h.alias}</label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <input placeholder="筛选作业名 / 路径…" value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1, minWidth: 120, padding: '4px 6px' }} />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">全部状态</option>
          {Object.keys(STATUS_META).map(k => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
        </select>
        <label>开始时间 <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '3px 4px' }} /> 至 <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '3px 4px' }} /></label>
        {(fromDate || toDate) && <button onClick={() => { setFromDate(''); setToDate('') }}>清除时间</button>}
        <label>刷新(min) <input type="number" min="1" value={intervalMin} onChange={e => setIntervalMin(Math.max(1, Number(e.target.value) || DEFAULT_INTERVAL_MIN))} style={{ width: 60, padding: '4px 6px' }} /></label>
        <button onClick={() => tickRef.current()}>手动刷新</button>
        <span style={{ opacity: 0.7 }}>{lastRefresh ? `上次 ${lastRefresh}` : ''}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <input placeholder="手动添加任务路径（远程绝对路径）" value={newBase} onChange={e => setNewBase(e.target.value)} style={{ flex: 1, minWidth: 160, padding: '4px 6px' }} />
        <button onClick={() => { const b = newBase.trim(); if (b && !extraBases.includes(b)) setExtraBases([...extraBases, b]); setNewBase('') }}>添加路径</button>
      </div>
      {extraBases.length > 0 && (
        <div style={{ marginBottom: 8, flexShrink: 0 }}>
          {extraBases.map(b => (<span key={b} style={{ display: 'inline-block', margin: '2px 4px', padding: '2px 6px', border: '1px solid #30363d', borderRadius: 4 }}>{b} <button onClick={() => setExtraBases(extraBases.filter(x => x !== b))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#f85149' }}>×</button></span>))}
        </div>
      )}
      {error && <div style={{ color: '#f85149', flexShrink: 0 }}>错误: {error}</div>}
      <div ref={scrollRef} style={{ flex: '1 1 auto', minHeight: 80, maxHeight: 520 + hBarH, overflow: 'auto', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: totalWidth, fontSize: 12 }}>
          <colgroup>
            {COLS.map(c => <col key={c.key} style={{ width: widths[c.key] }} />)}
          </colgroup>
          <thead>
            <tr>{COLS.map(c => th(c))}</tr>
          </thead>
          <tbody>
            {pageRows.map(j => {
              const sm = STATUS_META[j.status] || { label: j.status, color: 'gray' }
              return (
                <tr key={j.server + ':' + j.tag} style={{ borderTop: '1px solid #30363d' }}>
                  <td style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${j.remote}（点击查看结构）`} onClick={() => { if (onOpenStructure) onOpenStructure({ server: j.server, job: j.job, remoteDir: j.remote }); else window.dispatchEvent(new CustomEvent('castep-open-structure', { detail: { server: j.server, job: j.job, remoteDir: j.remote } })) }}>{j.job}{j.tag !== j.job && <div style={{ opacity: 0.6, fontSize: 10 }}>{j.tag}</div>}</td>
                  <td>{j.server}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.remote}>{j.remote}</td>
                  <td style={{ color: sm.color }}>{sm.label}</td>
                  <td style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>{j.start || '-'}</td>
                  <td>{j.ion ?? '-'}</td>
                  <td>{j.scf ?? '-'}</td>
                  <td>{j.energy != null ? j.energy.toFixed(4) : '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{j.status === 'converged' && j.total != null ? fmtDuration(j.total) : '-'}</td>
                  <td>
                    <button title="下载 .castep / .geom / .cell" onClick={() => { ['castep','geom','cell'].forEach(async ext => { try { await downloadFile(j.server, `${j.remote}/${j.job}.${ext}`, `${j.job}.${ext}`) } catch {} }) }}>下载</button>
                    <button title="删除远端目录（需确认）" onClick={() => { if (window.confirm(`确认删除远端目录 ${j.remote} ？此操作不可撤销。`)) { exec(j.server, `rm -rf ${j.remote}`).then(() => { setJobs(js => js.filter(x => x !== j)); alert('已删除'); }).catch(e => alert('删除失败: ' + e)) } }} style={{ color: '#f85149' }}>删除</button>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && <tr><td colSpan={COLS.length} style={{ opacity: 0.7 }}>暂无作业</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹ 上一页</button>
        <span>第 {curPage} / {totalPage} 页 · 共 {filtered.length} 个作业</span>
        <button disabled={curPage >= totalPage} onClick={() => setPage(curPage + 1)}>下一页 ›</button>
        <label>每页
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value) || 50)} style={{ marginLeft: 4, padding: '2px 4px' }}>
            {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
            <option value={100000}>全部</option>
          </select>
        </label>
      </div>
    </div>
  )
}

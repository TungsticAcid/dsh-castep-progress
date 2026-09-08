/**
 * StructureViewer.tsx — CASTEP 结构查看器（three.js）
 *
 * 复用 dsh-ssh 插件的 `/api/dsh-ssh/exec` 读取远程 `.geom`（固定格式轨迹：
 * 每帧以 `<-- c` 行开始，含 `h`(晶格) / `R`(原子坐标) / `F`(力)），解析
 * 逐帧结构并渲染原子球 + 晶胞框。提供帧滑块 + 播放/暂停；正交投影；
 * 左键旋转、中/右键或 Shift+左键平移、滚轮缩放；背景色与逐元素配色可调。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

const API = '/api/dsh-ssh/exec'

async function exec(alias: string, command: string, timeoutMs = 60000): Promise<string> {
  const res = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, command, timeoutMs }),
  })
  if (!res.ok) throw new Error(`exec ${res.status}`)
  const data = await res.json()
  const r = data?.result ?? {}
  return r.success ? (r.stdout ?? '') : ''
}

interface Frame { cell: number[][]; atoms: { element: string; xyz: number[] }[] }
export interface StructJob { server: string; job: string; remoteDir: string }

// 元素颜色（近似 CPK）
const ELEM: Record<string, string> = {
  H: '#ffffff', C: '#333333', N: '#3050f8', O: '#ff0d0d',
  Ni: '#3d9b5c', Co: '#a6a6a6', Cu: '#c88033', Pt: '#d0d0e0', Pd: '#808080',
  Ru: '#6060ff', Fe: '#e06633', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0',
  Zn: '#7d80b0'
}

const DEFAULT_BG = '#0d1117'

/** 解析 CASTEP 固定格式 .geom 轨迹（逐帧）。 */
function parseGeomFrames(text: string): Frame[] {
  const frames: Frame[] = []
  let cur: Frame | null = null
  let cellRows: number[][] = []
  for (const raw of text.split('\n')) {
    const ln = raw.trim()
    if (ln.endsWith('<-- c')) {
      if (cur) frames.push(cur)
      cur = { cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], atoms: [] }
      cellRows = []
      continue
    }
    if (!cur) continue
    if (ln.endsWith('<-- h')) {
      const nums = ln.replace('<-- h', '').trim().split(/\s+/).map(Number).filter(n => Number.isFinite(n))
      if (nums.length >= 3 && cellRows.length < 3) cellRows.push(nums.slice(0, 3))
      if (cellRows.length === 3) cur.cell = cellRows
    } else if (ln.endsWith('<-- R')) {
      const parts = ln.replace('<-- R', '').trim().split(/\s+/)
      if (parts.length >= 5) {
        const xyz = parts.slice(2, 5).map(Number)
        if (xyz.every(n => Number.isFinite(n))) cur.atoms.push({ element: parts[0], xyz })
      }
    }
  }
  if (cur) frames.push(cur)
  return frames.filter(f => f.atoms.length > 0)
}

/** 解析 .cell（%BLOCK 格式）成单帧。 */
function parseCellFrames(text: string): Frame[] {
  const lat = /%BLOCK LATTICE_CART\s+([\s\S]+?)%ENDBLOCK LATTICE_CART/.exec(text)
  const pos = /%BLOCK POSITIONS_FRAC\s+([\s\S]+?)%ENDBLOCK POSITIONS_FRAC/.exec(text) || /%BLOCK POSITIONS_ABS\s+([\s\S]+?)%ENDBLOCK POSITIONS_ABS/.exec(text)
  if (!pos) return []
  let cell: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  if (lat) {
    cell = lat[1].split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(r => r.length >= 3).slice(0, 3).map(r => r.slice(0, 3))
  }
  const abs = /%BLOCK POSITIONS_ABS/.test(pos[0])
  const atoms: { element: string; xyz: number[] }[] = []
  for (const l of pos[1].split('\n')) {
    const t = l.trim()
    if (!t || t.startsWith('%')) continue
    const p = t.split(/\s+/)
    if (p.length < 4) continue
    const xyz = p.slice(1, 4).map(Number)
    atoms.push({ element: p[0], xyz: abs ? xyz : fracToCart(xyz, cell) })
  }
  return atoms.length ? [{ cell, atoms }] : []
}

function fracToCart(frac: number[], cell: number[][]): number[] {
  const [a, b, c] = cell
  return [
    frac[0]*a[0] + frac[1]*b[0] + frac[2]*c[0],
    frac[0]*a[1] + frac[1]*b[1] + frac[2]*c[1],
    frac[0]*a[2] + frac[1]*b[2] + frac[2]*c[2],
  ]
}

/** 晶胞 8 个角。 */
function cellCorners(cell: number[][]): number[][] {
  const [a, b, c] = cell
  const add = (p: number[], q: number[]) => [p[0]+q[0], p[1]+q[1], p[2]+q[2]]
  return [
    [0, 0, 0], a, add(a, b), b,
    c, add(a, c), add(b, c), add(add(a, b), c),
  ]
}

/** 12 条边（平行六面体正确连线）。 */
function cellEdges(cell: number[][]): [number[], number[]][] {
  const P = cellCorners(cell)
  const idx: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [2, 7], [3, 6],
  ]
  return idx.map(([i, j]) => [P[i], P[j]])
}

export function StructureViewer(props: { job: StructJob | null; onClose?: () => void; onBack?: () => void }) {
  const { job, onClose, onBack } = props
  const noJob = !job || !job.job
  const mountRef = useRef<HTMLDivElement>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState('')
  const [play, setPlay] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bgColor, setBgColor] = useState(DEFAULT_BG)
  const [showGrid, setShowGrid] = useState(false)
  const [elemColors, setElemColors] = useState<Record<string, string>>({ ...ELEM })
  const [customElem, setCustomElem] = useState<Record<string, string>>({})
  const sceneRef = useRef<THREE.Scene>()
  const groupRef = useRef<THREE.Group>()
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer>()

  const presentElems = useMemo(() => Array.from(new Set(frames.flatMap(f => f.atoms.map(a => a.element)))).sort(), [frames])
  const atomColor = (el: string) => customElem[el] || elemColors[el] || '#9aa0a6'

  const load = async () => {
    setLoading(true); setError('')
    try {
      let fs = parseGeomFrames(await exec(job.server, `cat ${job.remoteDir}/${job.job}.geom 2>/dev/null`))
      if (fs.length === 0) fs = parseCellFrames(await exec(job.server, `cat ${job.remoteDir}/${job.job}.cell 2>/dev/null`))
      setFrames(fs); setFrame(0)
    } catch (e: any) { setError(String(e?.message ?? e)) }
    setLoading(false)
  }
  useEffect(() => { if (noJob) { setFrames([]); setLoading(false); return } load() }, [job?.job, job?.remoteDir, job?.server])

  useEffect(() => {
    if (!mountRef.current) return
    const el = mountRef.current
    const width = el.clientWidth, height = el.clientHeight
    const scene = new THREE.Scene(); scene.background = new THREE.Color(bgColor)
    const frustum = 20
    // 正交相机：near 设为负值避免“贴近内容被 near 平面裁掉”，far 足够大。
    const camera = new THREE.OrthographicCamera(-frustum*width/height, frustum*width/height, frustum, -frustum, -100, 1000)
    const target = new THREE.Vector3(0, 0, 0)
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3(28, 22, 28).sub(target))
    const applyCam = () => {
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph))
      camera.lookAt(target)
    }
    applyCam()
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height); el.appendChild(renderer.domElement)
    const group = new THREE.Group(); scene.add(group)
    const grid = new THREE.GridHelper(20, 10, 0x333, 0x222); grid.position.y = -6; grid.visible = showGrid; scene.add(grid)
    cameraRef.current = camera; sceneRef.current = scene; groupRef.current = group; gridRef.current = grid; rendererRef.current = renderer

    let dragging = false, mode: 'rotate' | 'pan' = 'rotate', lastX = 0, lastY = 0
    const onDown = (e: MouseEvent) => {
      if (e.button === 0 && !e.shiftKey) mode = 'rotate'
      else if (e.button === 0 && e.shiftKey) mode = 'pan'
      else if (e.button === 1 || e.button === 2) mode = 'pan'
      else return
      dragging = true; lastX = e.clientX; lastY = e.clientY
      if (e.button === 2 || e.button === 1) e.preventDefault()
    }
    const onMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY
      if (mode === 'pan') {
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
        const k = (frustum * 2) / camera.zoom * 0.002
        target.add(right.multiplyScalar(-dx * k)).add(up.multiplyScalar(dy * k))
      } else {
        sph.theta -= dx * 0.01
        sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.01))
      }
      applyCam()
    }
    const onUp = () => { dragging = false }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); camera.zoom = Math.max(0.2, Math.min(8, camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); camera.updateProjectionMatrix() }
    el.addEventListener('mousedown', onDown)
    el.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    let raf = 0
    const animate = () => { raf = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight
      camera.left = -frustum*w/h; camera.right = frustum*w/h; camera.top = frustum; camera.bottom = -frustum
      camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('contextmenu', () => {})
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('resize', onResize)
      renderer.dispose(); el.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => { if (sceneRef.current) sceneRef.current.background = new THREE.Color(bgColor) }, [bgColor])
  useEffect(() => { if (gridRef.current) gridRef.current.visible = showGrid }, [showGrid])

  useEffect(() => {
    const group = groupRef.current; if (!group) return
    while (group.children.length) { const c = group.children.pop()!; c.traverse(o => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose?.(); if (o instanceof THREE.Mesh) (o.geometry as THREE.Geometry).dispose?.() }) }
    const f = frames[frame]; if (!f) return
    const sphereGeom = new THREE.SphereGeometry(1, 24, 24)
    for (const a of f.atoms) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(atomColor(a.element)) })
      const mesh = new THREE.Mesh(sphereGeom, mat)
      mesh.position.set(a.xyz[0], a.xyz[1], a.xyz[2]); mesh.scale.setScalar(0.5)
      group.add(mesh)
    }
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8888ff })
    for (const [p, q] of cellEdges(f.cell)) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p), new THREE.Vector3(...q)])
      group.add(new THREE.Line(geo, lineMat))
    }
  }, [frames, frame, customElem, elemColors])

  useEffect(() => {
    if (!play || frames.length < 2) return
    const id = setInterval(() => setFrame(fr => (fr + 1) % frames.length), 400)
    return () => clearInterval(id)
  }, [play, frames.length])

  if (noJob) {
    return (
      <div style={{ fontFamily: 'Consolas, monospace', padding: 8 }}>
        <h2 style={{ margin: 0 }}>结构查看</h2>
        <p style={{ opacity: 0.7 }}>先在「CASTEP 进度」里点一个作业，即可查看其结构（初始→当前逐帧 + 播放）。</p>
        {onClose && <button onClick={onClose}>‹ 关闭</button>}
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'Consolas, monospace', padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>结构查看:{job.job}</h2>
        {onBack && <button onClick={onBack}>‹ 返回进度</button>}
        {onClose && <button onClick={onClose} style={{ marginLeft: 'auto' }}>‹ 关闭</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setPlay(p => !p)} disabled={frames.length < 2}>{play ? '暂停' : '播放'}</button>
        <span>帧 {frame + 1} / {frames.length || '-'}</span>
        <button onClick={() => setFrame(fr => Math.max(0, fr - 1))} disabled={frame === 0}>上一帧</button>
        <button onClick={() => setFrame(fr => Math.min(frames.length - 1, fr + 1))} disabled={frame >= frames.length - 1}>下一帧</button>
        <button onClick={load}>重新加载</button>
        <label>背景 <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} /></label>
        <label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> 网格</label>
      </div>
      {presentElems.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {presentElems.map(el => (
            <label key={el} title={`${el} 颜色`}>
              {el} <input type="color" value={customElem[el] || atomColor(el)} onChange={e => setCustomElem(s => ({ ...s, [el]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
      <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={frame} onChange={e => setFrame(Number(e.target.value))} disabled={frames.length < 2} style={{ width: '100%' }} />
      {error && <div style={{ color: '#f85149' }}>错误: {error}</div>}
      {loading && <div style={{ opacity: 0.7 }}>加载中…</div>}
      {!loading && frames.length === 0 && <div style={{ opacity: 0.7 }}>未找到结构帧（没有 .geom，也读不到 .cell）</div>}
      <div ref={mountRef} style={{ width: '100%', height: 480, marginTop: 8, cursor: 'grab' }} />
    </div>
  )
}

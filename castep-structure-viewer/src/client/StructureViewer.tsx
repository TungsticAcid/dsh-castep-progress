/**
 * StructureViewer.tsx — CASTEP 结构查看器（三.js）
 *
 * 复用 dsh-ssh 插件的 `/api/dsh-ssh/exec` 读取远程 `.geom`（几何轨迹，含
 * 初始→当前每帧），解析逐帧结构并用 three.js 渲染原子球 + 晶胞框。
 * 提供帧滑块 + 播放/暂停动画。渲染思路参考 Symmetry Viewer（H5，three.js）。
 */
import { useEffect, useRef, useState } from 'react'
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

/** 从 CASTEP `.geom` 文本提取逐帧结构。 */
function parseGeomFrames(text: string): Frame[] {
  const latBlocks: number[][][] = []
  const posBlocks: { element: string; frac: number[] }[][] = []
  const latRe = /%BLOCK LATTICE_CART\s+([\s\S]+?)%ENDBLOCK LATTICE_CART/g
  const fracRe = /%BLOCK POSITIONS_FRAC\s+([\s\S]+?)%ENDBLOCK POSITIONS_FRAC/g
  const absRe = /%BLOCK POSITIONS_ABS\s+([\s\S]+?)%ENDBLOCK POSITIONS_ABS/g

  let m: RegExpExecArray | null
  while ((m = latRe.exec(text))) latBlocks.push(parseLattice(m[1]))
  while ((m = fracRe.exec(text))) posBlocks.push(parsePositions(m[1], true))
  while ((m = absRe.exec(text))) posBlocks.push(parsePositions(m[1], false))

  if (posBlocks.length === 0) return []
  const frames: Frame[] = []
  for (let i = 0; i < posBlocks.length; i++) {
    const cell = latBlocks[i] ?? latBlocks[0] ?? [[1,0,0],[0,1,0],[0,0,1]]
    const atoms = posBlocks[i].map(a => ({ element: a.element, xyz: fracToCart(a.frac, cell) }))
    frames.push({ cell, atoms })
  }
  return frames
}

function parseLattice(s: string): number[][] {
  const rows: number[][] = []
  for (const ln of s.split('\n')) {
    const t = ln.trim()
    if (!t || t.startsWith('%')) continue
    const nums = t.split(/\s+/).map(Number).filter(n => Number.isFinite(n))
    if (nums.length >= 3) rows.push(nums.slice(0, 3))
    if (rows.length === 3) break
  }
  return rows.length === 3 ? rows : [[1,0,0],[0,1,0],[0,0,1]]
}

function parsePositions(s: string, frac: boolean): { element: string; frac: number[] }[] {
  const atoms: { element: string; frac: number[] }[] = []
  for (const ln of s.split('\n')) {
    const t = ln.trim()
    if (!t || t.startsWith('%')) continue
    const parts = t.split(/\s+/)
    if (parts.length < 4) continue
    const el = parts[0]
    const nums = parts.slice(1, 4).map(Number)
    if (!frac) nums[0] = nums[0]
    atoms.push({ element: el, frac: nums })
  }
  return atoms
}

function fracToCart(frac: number[], cell: number[][]): number[] {
  const [a, b, c] = cell
  return [
    frac[0]*a[0] + frac[1]*b[0] + frac[2]*c[0],
    frac[0]*a[1] + frac[1]*b[1] + frac[2]*c[1],
    frac[0]*a[2] + frac[1]*b[2] + frac[2]*c[2],
  ]
}

function cellEdges(cell: number[][]): number[][] {
  const [a, b, c] = cell
  const P = [
    [0,0,0], a, [a[0]+b[0],a[1]+b[1],a[2]+b[2]], b,
    c, [a[0]+c[0],a[1]+c[1],a[2]+c[2]],
    [b[0]+c[0],b[1]+c[1],b[2]+c[2]],
    [a[0]+b[0]+c[0],a[1]+b[1]+c[1],a[2]+b[2]+c[2]],
  ]
  const idx = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]
  return idx.map(([i,j]) => [P[i], P[j]])
}

export function StructureViewer(props: { job: StructJob; onClose?: () => void; onBack?: () => void }) {
  const { job, onClose, onBack } = props
  const mountRef = useRef<HTMLDivElement>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState('')
  const [play, setPlay] = useState(false)
  const [loading, setLoading] = useState(true)
  const sceneRef = useRef<THREE.Scene>()
  const groupRef = useRef<THREE.Group>()
  const rendererRef = useRef<THREE.WebGLRenderer>()
  const controlsRef = useRef<unknown>()

  const load = async () => {
    setLoading(true); setError('')
    try {
      let text = await exec(job.server, `cat ${job.remoteDir}/${job.job}.geom 2>/dev/null`)
      let fs = parseGeomFrames(text)
      if (fs.length === 0) {
        // 回退：读 .cell 单帧（初始结构）
        const cell = await exec(job.server, `cat ${job.remoteDir}/${job.job}.cell 2>/dev/null`)
        fs = parseGeomFrames(cell)
      }
      setFrames(fs)
      setFrame(0)
    } catch (e: any) { setError(String(e?.message ?? e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [job.job, job.remoteDir, job.server])

  // 初始化 three.js 场景
  useEffect(() => {
    if (!mountRef.current) return
    const width = mountRef.current.clientWidth; const height = mountRef.current.clientHeight
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d1117)
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 100)
    camera.position.set(12, 10, 12); camera.lookAt(0, 0, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height); mountRef.current.appendChild(renderer.domElement)
    // 用固定相机 + 自动缓慢旋转（原 OrbitControls 省去示例子路径依赖）
    const group = new THREE.Group(); scene.add(group)
    const grid = new THREE.GridHelper(20, 10, 0x333, 0x222); grid.position.y = -5; scene.add(grid)
    sceneRef.current = scene; groupRef.current = group; rendererRef.current = renderer; controlsRef.current = null

    let raf = 0
    const animate = () => { raf = requestAnimationFrame(animate); if (groupRef.current) groupRef.current.rotation.y += 0.004; renderer.render(scene, camera) }
    animate()
    const onResize = () => {
      const w = mountRef.current?.clientWidth ?? width; const h = mountRef.current?.clientHeight ?? height
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); renderer.dispose(); mountRef.current?.removeChild(renderer.domElement) }
  }, [])

  // 渲染当前帧
  useEffect(() => {
    const group = groupRef.current; if (!group) return
    while (group.children.length) { const c = group.children.pop()!; c.traverse(o => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose?.(); if (o instanceof THREE.Mesh) (o.geometry as THREE.Geometry).dispose?.() }) }
    const f = frames[frame]; if (!f) return
    const sphereGeom = new THREE.SphereGeometry(1, 24, 24)
    for (const a of f.atoms) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ELEM[a.element] ?? '#999') })
      const mesh = new THREE.Mesh(sphereGeom, mat)
      mesh.position.set(a.xyz[0], a.xyz[1], a.xyz[2]); mesh.scale.setScalar(0.5)
      group.add(mesh)
    }
    const edges = cellEdges(f.cell)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8888ff })
    for (const [p, q] of edges) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p), new THREE.Vector3(...q)])
      group.add(new THREE.Line(geo, lineMat))
    }
  }, [frames, frame])

  // 播放动画
  useEffect(() => {
    if (!play || frames.length < 2) return
    const id = setInterval(() => setFrame(fr => (fr + 1) % frames.length), 400)
    return () => clearInterval(id)
  }, [play, frames.length])

  return (
    <div style={{ fontFamily: 'Consolas, monospace', padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>结构查看：{job.job}</h2>
        {onBack && <button onClick={onBack}>‹ 返回进度</button>}
        {onClose && <button onClick={onClose} style={{ marginLeft: 'auto' }}>‹ 返回对话</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
        <button onClick={() => setPlay(p => !p)} disabled={frames.length < 2}>{play ? '暂停' : '播放'}</button>
        <span>帧 {frame + 1} / {frames.length || '-'}</span>
        <button onClick={() => setFrame(fr => Math.max(0, fr - 1))} disabled={frame === 0}>上一帧</button>
        <button onClick={() => setFrame(fr => Math.min(frames.length - 1, fr + 1))} disabled={frame >= frames.length - 1}>下一帧</button>
        <button onClick={load}>重新加载</button>
      </div>
      <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={frame} onChange={e => setFrame(Number(e.target.value))} disabled={frames.length < 2} style={{ width: '100%' }} />
      {error && <div style={{ color: '#f85149' }}>错误: {error}</div>}
      {loading && <div style={{ opacity: 0.7 }}>加载中…</div>}
      {!loading && frames.length === 0 && <div style={{ opacity: 0.7 }}>未找到结构帧（没有 .geom，也读不到 .cell）</div>}
      <div ref={mountRef} style={{ width: '100%', height: 480, marginTop: 8 }} />
    </div>
  )
}

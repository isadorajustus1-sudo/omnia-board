import React, { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from './supabase'

const uid = () => Math.random().toString(36).slice(2, 9)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const clone = (o) => JSON.parse(JSON.stringify(o))
const NOTE_COLORS = ['#ffd94d', '#ffb26b', '#7ee787', '#79c0ff', '#d2a8ff', '#ff7eb6', '#e6edf3']
const PEER_COLORS = ['#ff7eb6', '#7ee787', '#79c0ff', '#ffd94d', '#d2a8ff', '#ff9a5a', '#5eead4', '#f778ba']
const CONN_COLORS = ['#8a76ac', '#2b2333', '#c0392b', '#79c0ff', '#7ee787']
// post-it (sticky) fica por último na barra
const TOOLS = [
  ['select', '↖', 'Selecionar (V)'], ['rect', '▭', 'Retângulo'], ['ellipse', '◯', 'Elipse'],
  ['arrow', '↗', 'Seta'], ['text', 'T', 'Texto (T)'], ['pen', '✎', 'Caneta'], ['sticky', 'postit', 'Post-it (N)'],
]

// caixa (bounding box) de qualquer objeto em coords do mundo
const bboxOf = (o) => {
  if (o.type === 'arrow') return { x: Math.min(o.x, o.x2), y: Math.min(o.y, o.y2), w: Math.abs(o.x2 - o.x), h: Math.abs(o.y2 - o.y) }
  if (o.type === 'pen') { const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } }
  if (o.type === 'text') { const lines = String(o.text || 'texto').split('\n'); const w = Math.max(60, Math.max(...lines.map(l => l.length)) * 11); return { x: o.x, y: o.y, w, h: lines.length * 26 } }
  return { x: o.x, y: o.y, w: o.w, h: o.h }
}
const rectsIntersect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// ponto de ancoragem (meio de cada lado) de um elemento com w/h
const anchorPoint = (el, side) => {
  const w = el.w || 0, h = el.h || 0
  if (side === 't') return { x: el.x + w / 2, y: el.y }
  if (side === 'b') return { x: el.x + w / 2, y: el.y + h }
  if (side === 'l') return { x: el.x, y: el.y + h / 2 }
  if (side === 'r') return { x: el.x + w, y: el.y + h / 2 }
  return { x: el.x + w / 2, y: el.y + h / 2 }
}
const nearestSide = (el, from) => {
  let best = 't', bd = Infinity
  for (const s of ['t', 'r', 'b', 'l']) { const p = anchorPoint(el, s); const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2; if (d < bd) { bd = d; best = s } }
  return best
}
const CONNECTABLE = (t) => t === 'sticky' || t === 'rect' || t === 'ellipse'

// rota ortogonal (tipo fluxograma) entre duas portas, saindo perpendicular de cada lado
const SIDE_DIR = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0], c: [0, 0] }
// distância de um ponto a um segmento (world)
const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
const elbowPath = (p1, s1, p2, s2, mid) => {
  const stub = 26
  const d1 = SIDE_DIR[s1] || [0, 0], d2 = SIDE_DIR[s2] || [0, 0]
  const a = { x: p1.x + d1[0] * stub, y: p1.y + d1[1] * stub }
  const b = { x: p2.x + d2[0] * stub, y: p2.y + d2[1] * stub }
  const h1 = d1[0] !== 0, h2 = d2[0] !== 0
  const pts = [p1, a]
  if (mid && typeof mid === 'object') {
    // rota manual em Z passando pelo pivô {x,y} — 1 segmento vertical (x=mid.x) e 1 horizontal (y=mid.y), ambos móveis
    const mx = mid.x, my = mid.y
    if (h1) pts.push({ x: mx, y: a.y }, { x: mx, y: my }, { x: b.x, y: my })
    else pts.push({ x: a.x, y: my }, { x: mx, y: my }, { x: mx, y: b.y })
    pts.push(b, p2)
    return pts
  }
  // rota automática (simples)
  if (h1 && h2) { const mx = (a.x + b.x) / 2; pts.push({ x: mx, y: a.y }, { x: mx, y: b.y }) }
  else if (!h1 && !h2) { const my = (a.y + b.y) / 2; pts.push({ x: a.x, y: my }, { x: b.x, y: my }) }
  else if (h1 && !h2) { pts.push({ x: b.x, y: a.y }) }
  else { pts.push({ x: a.x, y: b.y }) }
  pts.push(b, p2)
  return pts
}
// resolve as duas pontas de um conector (lado flutuante 'auto' recalculado pela posição do outro objeto)
const connectorEnds = (o, m) => {
  const o1 = o.a1 && m[o.a1.id]; const o2 = o.a2 && m[o.a2.id]
  const resolveSide = (a, self, other, freePt) => {
    if (!a) return null
    if (a.side && a.side !== 'auto') return a.side
    const ref = other ? { x: other.x + (other.w || 0) / 2, y: other.y + (other.h || 0) / 2 } : freePt
    return nearestSide(self, ref)
  }
  const side1 = o1 ? resolveSide(o.a1, o1, o2, { x: o.x2, y: o.y2 }) : null
  const side2 = o2 ? resolveSide(o.a2, o2, o1, { x: o.x, y: o.y }) : null
  const p1 = o1 ? anchorPoint(o1, side1) : { x: o.x, y: o.y }
  const p2 = o2 ? anchorPoint(o2, side2) : { x: o.x2, y: o.y2 }
  return { p1, p2, side1, side2 }
}
// path SVG com cantos arredondados a partir de uma lista de pontos
const roundedPath = (pts, r = 12) => {
  if (!pts || pts.length < 2) return ''
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1]
    const l1 = dist(p0, p1) || 1, l2 = dist(p1, p2) || 1
    const r1 = Math.min(r, l1 / 2), r2 = Math.min(r, l2 / 2)
    const a = { x: p1.x - (p1.x - p0.x) / l1 * r1, y: p1.y - (p1.y - p0.y) / l1 * r1 }
    const b = { x: p1.x + (p2.x - p1.x) / l2 * r2, y: p1.y + (p2.y - p1.y) / l2 * r2 }
    d += ` L ${a.x} ${a.y} Q ${p1.x} ${p1.y} ${b.x} ${b.y}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

function OmniaLogo() {
  return <img className="ob-img" src="/logo.png" alt="omnia.board" draggable="false" />
}

function CursorIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 22 22" style={{ display: 'block' }}>
      <path d="M4,3 L4,17.5 L8.2,13.4 L11,19.6 L13.4,18.5 L10.6,12.5 L16,12.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />
    </svg>
  )
}

const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// editor de texto RICO (negrito/itálico por seleção) usado por sticky, texto e formas
function Rich({ o, editing, editRef, className, style, ph, onChange, onBlur }) {
  const ref = useRef(null)
  const fill = () => { const el = ref.current; if (!el) return; const h = o.html != null ? o.html : escapeHtml(o.text); if (el.innerHTML !== h) el.innerHTML = h }
  useEffect(() => { if (!editing) fill() }, [o.html, o.text, editing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing) return
    fill(); const el = ref.current; if (!el) return
    if (editRef) editRef.current = el
    el.focus()
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={'rt ' + className} contentEditable={editing} suppressContentEditableWarning
      data-ph={ph || ''} style={style}
      onInput={(e) => onChange({ html: e.currentTarget.innerHTML, text: e.currentTarget.innerText })}
      onBlur={onBlur} />
  )
}

export default function Board({ boardId, boardName = 'Quadro', user, onExit }) {
  const meId = user.id
  const meColor = useRef(PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)]).current
  const name = user.name

  const [objs, setObjs] = useState({})
  const [tool, setTool] = useState('select')
  const [color, setColor] = useState(NOTE_COLORS[0])
  const [selIds, setSelIds] = useState(() => new Set())
  const [editing, setEditing] = useState(null)
  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const [peers, setPeers] = useState({})
  const [cursors, setCursors] = useState({})
  const [panning, setPanning] = useState(false)
  const [marquee, setMarquee] = useState(null)
  const [hoverId, setHoverId] = useState(null)
  const [connTarget, setConnTarget] = useState(null)
  const [menu, setMenu] = useState(null)
  const [commentFor, setCommentFor] = useState(null)
  const [commentText, setCommentText] = useState('')

  const vpRef = useRef(null)
  const objsRef = useRef(objs); useEffect(() => { objsRef.current = objs }, [objs])
  const viewRef = useRef(view); useEffect(() => { viewRef.current = view }, [view])
  const selRef = useRef(selIds); useEffect(() => { selRef.current = selIds }, [selIds])
  const chanRef = useRef(null)
  const drag = useRef(null)
  const spaceRef = useRef(false)
  const saveT = useRef(null)
  const editRef = useRef(null)
  const editBefore = useRef(null)
  const hist = useRef({ undo: [], redo: [] })
  const clip = useRef([])

  const scheduleSave = useCallback(() => {
    clearTimeout(saveT.current)
    saveT.current = setTimeout(async () => {
      try { await supabase.from('boards').update({ data: { objs: objsRef.current }, updated_at: new Date().toISOString() }).eq('id', boardId) } catch (e) {}
    }, 700)
  }, [boardId])

  // aplica uma op (up/del/patch) ou um lote (batch) de ops
  const applyOp = useCallback((op, local = true) => {
    setObjs(prev => {
      const n = { ...prev }
      const one = (op) => {
        if (op.t === 'up') n[op.o.id] = op.o
        else if (op.t === 'del') delete n[op.id]
        else if (op.t === 'patch') { if (n[op.id]) n[op.id] = { ...n[op.id], ...op.p } }
      }
      if (op.t === 'batch') op.ops.forEach(one); else one(op)
      return n
    })
    if (local) { chanRef.current?.send({ type: 'broadcast', event: 'op', payload: op }); scheduleSave() }
  }, [scheduleSave])

  const lastPatch = useRef(0)
  const livePatch = useCallback((id, p) => {
    setObjs(prev => { const o = prev[id]; if (!o) return prev; return { ...prev, [id]: { ...o, ...p } } })
    const t = performance.now()
    if (t - lastPatch.current > 33) { lastPatch.current = t; chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'patch', id, p } }) }
  }, [])

  const pushHist = (undoOp, redoOp) => { hist.current.undo.push({ undo: undoOp, redo: redoOp }); if (hist.current.undo.length > 100) hist.current.undo.shift(); hist.current.redo = [] }
  const histChange = (before, after) => { if (!before && !after) return; pushHist(before ? { t: 'up', o: before } : { t: 'del', id: after.id }, after ? { t: 'up', o: after } : { t: 'del', id: before.id }) }
  const doUndo = useCallback(() => { const e = hist.current.undo.pop(); if (!e) return; applyOp(e.undo, true); hist.current.redo.push(e); setSelIds(new Set()); setEditing(null) }, [applyOp])
  const doRedo = useCallback(() => { const e = hist.current.redo.pop(); if (!e) return; applyOp(e.redo, true); hist.current.undo.push(e) }, [applyOp])

  // realtime + load
  useEffect(() => {
    let alive = true
    ;(async () => {
      try { const { data } = await supabase.from('boards').select('data').eq('id', boardId).maybeSingle(); if (alive && data?.data?.objs) setObjs(data.data.objs) } catch (e) {}
    })()
    const chan = supabase.channel('omnia-board:' + boardId, { config: { presence: { key: meId }, broadcast: { self: false } } })
    chan.on('broadcast', { event: 'op' }, ({ payload }) => applyOp(payload, false))
    chan.on('broadcast', { event: 'cursor' }, ({ payload }) => setCursors(c => ({ ...c, [payload.id]: payload })))
    chan.on('broadcast', { event: 'req-state' }, ({ payload }) => { if (payload.id === meId) return; const cur = objsRef.current; if (Object.keys(cur).length) chan.send({ type: 'broadcast', event: 'state', payload: { objs: cur } }) })
    chan.on('broadcast', { event: 'state' }, ({ payload }) => setObjs(prev => ({ ...payload.objs, ...prev })))
    chan.on('presence', { event: 'sync' }, () => {
      const st = chan.presenceState(); const p = {}
      Object.values(st).forEach(arr => arr.forEach(u => { p[u.id] = { name: u.name, color: u.color } }))
      setPeers(p); setCursors(cs => { const n = {}; for (const k in cs) if (p[k]) n[k] = cs[k]; return n })
    })
    chan.subscribe(async (status) => { if (status === 'SUBSCRIBED') { await chan.track({ id: meId, name, color: meColor }); chan.send({ type: 'broadcast', event: 'req-state', payload: { id: meId } }) } })
    chanRef.current = chan
    return () => { alive = false; supabase.removeChannel(chan) }
  }, [boardId, applyOp, meId, name, meColor])

  const toWorld = (cx, cy) => { const r = vpRef.current.getBoundingClientRect(); const v = viewRef.current; return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z } }

  useEffect(() => {
    const el = vpRef.current
    const onWheel = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; setView(v => { const nz = clamp(v.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.15, 4); const wx = (mx - v.x) / v.z, wy = (my - v.y) / v.z; return { z: nz, x: mx - wx * nz, y: my - wy * nz } }) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const kd = (e) => {
      if (e.code === 'Space') spaceRef.current = true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { if (editing) return; e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return }
      if (mod && e.key.toLowerCase() === 'y') { if (editing) return; e.preventDefault(); doRedo(); return }
      if (mod && e.key.toLowerCase() === 'a') { if (editing) return; e.preventDefault(); setSelIds(new Set(Object.keys(objsRef.current))); return }
      if (mod && e.key.toLowerCase() === 'c' && !editing) { const ids = [...selRef.current].filter(id => objsRef.current[id]); if (ids.length) clip.current = ids.map(id => clone(objsRef.current[id])); return }
      if (mod && e.key.toLowerCase() === 'v' && !editing) {
        e.preventDefault(); const src = clip.current
        if (src && src.length) {
          const idMap = {}; src.forEach(o => { idMap[o.id] = uid() })
          const news = src.map(o => { const n = clone(o); n.id = idMap[o.id]; if (n.x != null) n.x += 24; if (n.y != null) n.y += 24; if (n.x2 != null) n.x2 += 24; if (n.y2 != null) n.y2 += 24; if (n.points) n.points = n.points.map(([px, py]) => [px + 24, py + 24]); if (n.type === 'arrow') { if (n.a1 && idMap[n.a1.id]) n.a1 = { ...n.a1, id: idMap[n.a1.id] }; if (n.a2 && idMap[n.a2.id]) n.a2 = { ...n.a2, id: idMap[n.a2.id] } } return n })
          const ups = news.map(o => ({ t: 'up', o })); applyOp({ t: 'batch', ops: ups }); pushHist({ t: 'batch', ops: news.map(o => ({ t: 'del', id: o.id })) }, { t: 'batch', ops: ups }); setSelIds(new Set(news.map(o => o.id)))
        }
        return
      }
      if (editing && mod && (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'i')) {
        e.preventDefault(); document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic', false)
        const el = editRef.current; if (el) livePatch(editing, { html: el.innerHTML, text: el.innerText }); return
      }
      if (editing) return
      if (e.key === 'Tab') {
        const ss = [...selRef.current]
        if (ss.length === 1) { const o = objsRef.current[ss[0]]; if (o && o.type === 'arrow') { e.preventDefault(); const modes = ['elbow', 'curved', 'straight']; const ni = (modes.indexOf(o.shape || 'elbow') + 1) % 3; mutate(ss[0], x => ({ ...x, shape: modes[ni] })) } }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = [...selRef.current].filter(id => objsRef.current[id])
        if (ids.length) {
          const idset = new Set(ids)
          const freeBefore = [], freeAfter = []
          Object.values(objsRef.current).forEach(o => {
            if (o.type === 'arrow' && !idset.has(o.id) && ((o.a1 && idset.has(o.a1.id)) || (o.a2 && idset.has(o.a2.id)))) {
              const g = connectorEnds(o, objsRef.current); const n = clone(o)
              if (o.a1 && idset.has(o.a1.id)) { n.a1 = null; n.x = g.p1.x; n.y = g.p1.y }
              if (o.a2 && idset.has(o.a2.id)) { n.a2 = null; n.x2 = g.p2.x; n.y2 = g.p2.y }
              freeBefore.push({ t: 'up', o: clone(o) }); freeAfter.push({ t: 'up', o: n })
            }
          })
          const delOps = ids.map(id => ({ t: 'del', id }))
          const upOps = ids.map(id => ({ t: 'up', o: clone(objsRef.current[id]) }))
          applyOp({ t: 'batch', ops: [...delOps, ...freeAfter] })
          pushHist({ t: 'batch', ops: [...upOps, ...freeBefore] }, { t: 'batch', ops: [...delOps, ...freeAfter] })
          setSelIds(new Set())
        }
        return
      }
      if (e.key === 'Escape') { setSelIds(new Set()); setEditing(null); setMenu(null); setCommentFor(null); return }
      if (e.key === 'v') setTool('select'); if (e.key === 'n') setTool('sticky'); if (e.key === 't') setTool('text')
    }
    const ku = (e) => { if (e.code === 'Space') spaceRef.current = false }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [editing, applyOp, doUndo, doRedo, livePatch])

  useEffect(() => { if (editing && editRef.current) editRef.current.focus() }, [editing])

  const startEdit = (id) => { const o = objsRef.current[id]; editBefore.current = o ? clone(o) : null; editRef.current = null; setEditing(id) }
  const endEdit = (id) => { setEditing(null); const after = objsRef.current[id]; if (after) { chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'up', o: after } }); scheduleSave(); histChange(editBefore.current, after) } editBefore.current = null }

  const sendCursorRef = useRef(0)
  const sendCursor = (wx, wy) => { const t = performance.now(); if (t - sendCursorRef.current < 33) return; sendCursorRef.current = t; chanRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { id: meId, name, color: meColor, x: wx, y: wy } }) }

  const setSelSingle = (id) => setSelIds(new Set(id ? [id] : []))
  const textStyle = (o) => ({ fontSize: o.fontSize ? o.fontSize + 'px' : undefined })
  const defFont = (o) => o.type === 'text' ? 20 : o.type === 'sticky' ? 16 : 15
  const mutate = (id, changer) => { const before = objsRef.current[id]; if (!before) return; const after = changer(clone(before)); applyOp({ t: 'up', o: after }); histChange(clone(before), after) }
  const topmostConnectableAt = (pt, excludeId, m = 0) => {
    const cand = Object.values(objsRef.current).filter(o => CONNECTABLE(o.type) && o.id !== excludeId)
    for (let i = cand.length - 1; i >= 0; i--) { const b = cand[i]; if (pt.x >= b.x - m && pt.x <= b.x + b.w + m && pt.y >= b.y - m && pt.y <= b.y + b.h + m) return b }
    return null
  }
  const applyFmt = (cmd) => { document.execCommand(cmd, false); const el = editRef.current; if (el && editing) livePatch(editing, { html: el.innerHTML, text: el.innerText }) }

  const onPointerDown = (e) => {
    // clicando/arrastando DENTRO de um texto em edição => deixa a seleção de texto nativa (não mexe no elemento)
    if (e.target.closest && e.target.closest('[contenteditable="true"]')) return
    const wp = toWorld(e.clientX, e.clientY)
    const handle = e.target?.dataset?.handle
    const rotate = !!e.target?.dataset?.rotate
    const anchor = e.target?.dataset?.anchor
    const anchorId = e.target?.dataset?.aid
    const eph = e.target?.dataset?.eph
    const seg = e.target?.dataset?.seg
    const hitId = e.target.closest('[data-id]')?.dataset.id
    vpRef.current.setPointerCapture(e.pointerId)
    setHoverId(null); setMenu(null); setCommentFor(null)

    // botão DIREITO num elemento => menu de contexto (o onContextMenu abre; aqui só não paneia)
    if (e.button === 2 && hitId) return
    // botão DIREITO / meio / espaço => arrastar a tela
    if (e.button === 2 || e.button === 1 || spaceRef.current) {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; setPanning(true); return
    }
    if (e.button !== 0) return

    // arrastar uma alça de segmento => reroteia só aquela reta (x = move vertical / y = move horizontal)
    if (seg && selRef.current.size === 1) {
      const id = [...selRef.current][0]; const o = objsRef.current[id]
      if (o && o.type === 'arrow') {
        const g = connectorEnds(o, objsRef.current)
        const mid0 = (o.mid && typeof o.mid === 'object') ? o.mid : (() => { const d1 = SIDE_DIR[g.side1 || 'r'], d2 = SIDE_DIR[g.side2 || 'l']; const a = { x: g.p1.x + d1[0] * 26, y: g.p1.y + d1[1] * 26 }, b = { x: g.p2.x + d2[0] * 26, y: g.p2.y + d2[1] * 26 }; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } })()
        drag.current = { mode: 'reroute', id, axis: seg, mid0, before: clone(o) }; return
      }
    }
    // reconectar uma ponta de um conector selecionado
    if (eph && selRef.current.size === 1) {
      const id = [...selRef.current][0]; const o = objsRef.current[id]
      if (o && o.type === 'arrow') { drag.current = { mode: 'reconnect', id, which: eph, before: clone(o) }; return }
    }
    // puxar um conector a partir de um ponto de ancoragem (meio do lado)
    if (anchor && anchorId && objsRef.current[anchorId]) {
      const src = objsRef.current[anchorId]; const p = anchorPoint(src, anchor)
      const o = { id: uid(), type: 'arrow', x: p.x, y: p.y, x2: wp.x, y2: wp.y, color: '#8a76ac', shape: 'elbow', a1: { id: anchorId, side: anchor } }
      applyOp({ t: 'up', o }); drag.current = { mode: 'connect', id: o.id }; return
    }

    // alça de girar
    if (rotate && selRef.current.size === 1) {
      const id = [...selRef.current][0]; const o = objsRef.current[id]; const b = bboxOf(o)
      drag.current = { mode: 'rotate', id, cx: b.x + b.w / 2, cy: b.y + b.h / 2, before: clone(o) }; return
    }
    // alça de redimensionar (canto)
    if (handle && selRef.current.size === 1) {
      const id = [...selRef.current][0]; const o = objsRef.current[id]
      drag.current = { mode: 'resize', id, corner: handle, sx: wp.x, sy: wp.y, orig: { x: o.x, y: o.y, w: o.w || 200, h: o.h || 50 }, before: clone(o) }; return
    }

    if (tool === 'select') {
      if (hitId) {
        const ho = objsRef.current[hitId]
        if (!e.shiftKey && ho && ho.type === 'arrow') { setSelSingle(hitId); return }
        if (e.shiftKey) { setSelIds(prev => { const n = new Set(prev); n.has(hitId) ? n.delete(hitId) : n.add(hitId); return n }); return }
        let ids
        if (selRef.current.has(hitId) && selRef.current.size > 1) ids = [...selRef.current]
        else { ids = [hitId]; setSelSingle(hitId) }
        const origins = {}, befores = {}
        ids.forEach(id => { const o = objsRef.current[id]; if (!o) return; const g = { x: o.x, y: o.y }; if (o.x2 != null) { g.x2 = o.x2; g.y2 = o.y2 } if (o.points) g.points = o.points; origins[id] = g; befores[id] = clone(o) })
        drag.current = { mode: 'move', ids, origins, befores, sx: wp.x, sy: wp.y, moved: false }
        return
      }
      // vazio com botão esquerdo => seleção por retângulo (marquee)
      setSelSingle(null)
      drag.current = { mode: 'marquee', sx: wp.x, sy: wp.y, rect: null }
      setMarquee({ x: wp.x, y: wp.y, w: 0, h: 0 })
      return
    }

    // ferramentas de criação
    let o = null
    if (tool === 'sticky') o = { id: uid(), type: 'sticky', x: wp.x - 90, y: wp.y - 60, w: 180, h: 120, text: '', color, rot: 0 }
    else if (tool === 'text') o = { id: uid(), type: 'text', x: wp.x, y: wp.y, w: 200, h: 50, text: '', color: '#2b2333', rot: 0 }
    else if (tool === 'rect' || tool === 'ellipse') { o = { id: uid(), type: tool, x: wp.x, y: wp.y, w: 1, h: 1, text: '', color, rot: 0 }; applyOp({ t: 'up', o }); drag.current = { mode: 'create', id: o.id, sx: wp.x, sy: wp.y }; return }
    else if (tool === 'arrow') {
      const startEl = topmostConnectableAt(wp)
      o = { id: uid(), type: 'arrow', x: wp.x, y: wp.y, x2: wp.x, y2: wp.y, color, shape: 'elbow' }
      if (startEl) o.a1 = { id: startEl.id, side: 'auto' }
      applyOp({ t: 'up', o }); drag.current = { mode: 'arrow', id: o.id }; return
    }
    else if (tool === 'pen') { o = { id: uid(), type: 'pen', x: 0, y: 0, points: [[wp.x, wp.y]], color }; applyOp({ t: 'up', o }); drag.current = { mode: 'pen', id: o.id }; return }
    if (o) { applyOp({ t: 'up', o }); pushHist({ t: 'del', id: o.id }, { t: 'up', o }); setSelSingle(o.id); setTool('select'); startEdit(o.id) }
  }

  const onPointerMove = (e) => {
    const wp = toWorld(e.clientX, e.clientY); sendCursor(wp.x, wp.y)
    const d = drag.current
    if (d && e.buttons === 0) { onPointerUp(); return } // botão já foi solto: encerra o arraste na hora
    if (!d) {
      // hover => mostra os pontos de conexão do elemento sob o cursor
      let over = null; const cand = Object.values(objsRef.current).filter(o => CONNECTABLE(o.type))
      for (let i = cand.length - 1; i >= 0; i--) { const o = cand[i]; if (wp.x >= o.x - 12 && wp.x <= o.x + o.w + 12 && wp.y >= o.y - 12 && wp.y <= o.y + o.h + 12) { over = o.id; break } }
      setHoverId(prev => prev === over ? prev : over); return
    }
    if (d.mode === 'pan') { setView(v => ({ ...v, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) })); return }
    if (d.mode === 'connect' || d.mode === 'arrow') {
      const arw = objsRef.current[d.id]
      const tgt = topmostConnectableAt(wp, arw?.a1?.id, 40) // ímã: pega de longe
      if (tgt) {
        const side = nearestSide(tgt, wp); const ap = anchorPoint(tgt, side) // ponto mais perto do CURSOR
        if (Math.hypot(ap.x - wp.x, ap.y - wp.y) <= 34) { livePatch(d.id, { x2: ap.x, y2: ap.y }); d.snapSide = side } // ímã no ponto (fixo)
        else { livePatch(d.id, { x2: wp.x, y2: wp.y }); d.snapSide = 'auto' } // no corpo => flutuante
      } else { livePatch(d.id, { x2: wp.x, y2: wp.y }); d.snapSide = null }
      setConnTarget(p => p === (tgt?.id || null) ? p : (tgt?.id || null)); return
    }
    if (d.mode === 'reconnect') {
      const tgt = topmostConnectableAt(wp, null, 40)
      let side = 'auto'
      if (tgt) { const s = nearestSide(tgt, wp); const ap = anchorPoint(tgt, s); if (Math.hypot(ap.x - wp.x, ap.y - wp.y) <= 34) side = s }
      if (d.which === 'start') { if (tgt) livePatch(d.id, { a1: { id: tgt.id, side } }); else livePatch(d.id, { a1: null, x: wp.x, y: wp.y }) }
      else { if (tgt) livePatch(d.id, { a2: { id: tgt.id, side } }); else livePatch(d.id, { a2: null, x2: wp.x, y2: wp.y }) }
      setConnTarget(p => p === (tgt?.id || null) ? p : (tgt?.id || null)); return
    }
    if (d.mode === 'reroute') {
      const o = objsRef.current[d.id]; if (!o || !o.a1 || !o.a2) return
      d.moved = true
      const cur = (o.mid && typeof o.mid === 'object') ? o.mid : d.mid0
      const m = { x: cur.x, y: cur.y }; m[d.axis] = d.axis === 'x' ? wp.x : wp.y
      livePatch(d.id, { mid: m })
      return
    }
    if (d.mode === 'marquee') { const x = Math.min(d.sx, wp.x), y = Math.min(d.sy, wp.y), w = Math.abs(wp.x - d.sx), h = Math.abs(wp.y - d.sy); d.rect = { x, y, w, h }; setMarquee(d.rect); return }
    if (d.mode === 'move') {
      const dx = wp.x - d.sx, dy = wp.y - d.sy; if (dx || dy) d.moved = true
      d.ids.forEach(id => {
        const o = objsRef.current[id]; if (!o) return; const g = d.origins[id]; if (!g) return
        let p
        if (o.type === 'arrow') p = { x: g.x + dx, y: g.y + dy, x2: g.x2 + dx, y2: g.y2 + dy }
        else if (o.type === 'pen') p = { points: g.points.map(([px, py]) => [px + dx, py + dy]) }
        else p = { x: g.x + dx, y: g.y + dy }
        livePatch(id, p)
      })
      return
    }
    if (d.mode === 'create') { livePatch(d.id, { x: Math.min(d.sx, wp.x), y: Math.min(d.sy, wp.y), w: Math.abs(wp.x - d.sx), h: Math.abs(wp.y - d.sy) }); return }
    if (d.mode === 'resize') {
      const dx = wp.x - d.sx, dy = wp.y - d.sy; const c = d.corner; let { x, y, w, h } = d.orig
      if (c.includes('e')) { w = Math.max(24, d.orig.w + dx); x = d.orig.x }
      if (c.includes('w')) { w = Math.max(24, d.orig.w - dx); x = d.orig.x + (d.orig.w - w) }
      if (c.includes('s')) { h = Math.max(24, d.orig.h + dy); y = d.orig.y }
      if (c.includes('n')) { h = Math.max(24, d.orig.h - dy); y = d.orig.y + (d.orig.h - h) }
      livePatch(d.id, { x, y, w, h }); return
    }
    if (d.mode === 'rotate') {
      let ang = Math.atan2(wp.y - d.cy, wp.x - d.cx) * 180 / Math.PI + 90
      if (e.shiftKey) ang = Math.round(ang / 15) * 15
      else { const near = Math.round(ang / 90) * 90; if (Math.abs(ang - near) < 4) ang = near }
      livePatch(d.id, { rot: ang }); return
    }
    if (d.mode === 'pen') { const o = objsRef.current[d.id]; if (!o) return; livePatch(d.id, { points: [...o.points, [wp.x, wp.y]] }); return }
  }

  const onPointerUp = () => {
    const d = drag.current; drag.current = null; setPanning(false); setConnTarget(null)
    if (!d) return
    if (d.mode === 'marquee') {
      const r = d.rect
      if (r && (r.w > 3 || r.h > 3)) { const hits = Object.values(objsRef.current).filter(o => rectsIntersect(bboxOf(o), r)).map(o => o.id); setSelIds(new Set(hits)) }
      setMarquee(null); return
    }
    if (d.mode === 'move') {
      if (d.moved) {
        const ups = [], befores = []
        d.ids.forEach(id => { const o = objsRef.current[id]; if (o) { ups.push({ t: 'up', o: clone(o) }); befores.push({ t: 'up', o: d.befores[id] }) } })
        ups.forEach(u => chanRef.current?.send({ type: 'broadcast', event: 'op', payload: u })); scheduleSave()
        pushHist({ t: 'batch', ops: befores }, { t: 'batch', ops: ups })
      }
      return
    }
    if (d.mode === 'connect') {
      const arw = objsRef.current[d.id]; if (!arw) return
      const pt = { x: arw.x2, y: arw.y2 }
      const target = topmostConnectableAt(pt, arw.a1?.id, 18)
      if (target) {
        const fin = { ...arw, a2: { id: target.id, side: d.snapSide || 'auto' } }
        applyOp({ t: 'up', o: fin }); pushHist({ t: 'del', id: arw.id }, { t: 'up', o: fin }); setSelSingle(arw.id)
      } else if (Math.hypot(arw.x2 - arw.x, arw.y2 - arw.y) < 12) {
        applyOp({ t: 'del', id: arw.id })
      } else {
        chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'up', o: arw } }); scheduleSave()
        pushHist({ t: 'del', id: arw.id }, { t: 'up', o: arw }); setSelSingle(arw.id)
      }
      return
    }
    if (d.mode === 'reconnect') {
      const o = objsRef.current[d.id]
      if (o) { chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'up', o } }); scheduleSave(); if (d.before) histChange(d.before, o) }
      return
    }
    if (d.mode === 'reroute') {
      const o = objsRef.current[d.id]
      if (o && d.moved) { chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'up', o } }); scheduleSave(); if (d.before) histChange(d.before, o) }
      return
    }
    if (d.mode === 'arrow') {
      const arw = objsRef.current[d.id]
      if (arw) {
        const endEl = topmostConnectableAt({ x: arw.x2, y: arw.y2 }, arw.a1?.id, 18)
        let fin = arw
        if (endEl) fin = { ...arw, a2: { id: endEl.id, side: d.snapSide || 'auto' } }
        applyOp({ t: 'up', o: fin }); pushHist({ t: 'del', id: arw.id }, { t: 'up', o: fin }); setSelSingle(arw.id)
      }
      setTool('select'); return
    }
    let o = objsRef.current[d.id]
    if (d.mode === 'create' && o && o.w < 8 && o.h < 8) { o = { ...o, w: 140, h: 90 }; applyOp({ t: 'up', o }) }
    if (['resize', 'rotate', 'pen'].includes(d.mode) && o) {
      chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'up', o } }); scheduleSave()
      if (d.before) histChange(d.before, o)
      else if (d.mode === 'pen') pushHist({ t: 'del', id: o.id }, { t: 'up', o })
    }
    if (d.mode === 'create' && o) { chanRef.current?.send({ type: 'broadcast', event: 'op', payload: { t: 'up', o } }); scheduleSave(); pushHist({ t: 'del', id: o.id }, { t: 'up', o }); setTool('select'); setSelSingle(o.id) }
  }

  const setSelColor = (c) => {
    setColor(c)
    const ids = [...selRef.current].filter(id => objsRef.current[id])
    if (ids.length) {
      const befores = ids.map(id => ({ t: 'up', o: clone(objsRef.current[id]) }))
      const ups = ids.map(id => ({ t: 'up', o: { ...objsRef.current[id], color: c } }))
      applyOp({ t: 'batch', ops: ups }); pushHist({ t: 'batch', ops: befores }, { t: 'batch', ops: ups })
    }
  }
  const zoomTo = (nz) => setView(v => { const el = vpRef.current.getBoundingClientRect(); const mx = el.width / 2, my = el.height / 2; const wx = (mx - v.x) / v.z, wy = (my - v.y) / v.z; return { z: nz, x: mx - wx * nz, y: my - wy * nz } })

  const others = Object.entries(peers).filter(([id]) => id !== meId)
  const cbadge = (o) => o.comments?.length ? <div className="cbadge" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setCommentText(''); setMenu(null); setCommentFor({ id: o.id, x: e.clientX, y: e.clientY }) }}>💬 {o.comments.length}</div> : null

  const selArr = [...selIds]
  const soleSel = selArr.length === 1 ? objs[selArr[0]] : null
  const showFrame = soleSel && (soleSel.type === 'sticky' || soleSel.type === 'rect' || soleSel.type === 'ellipse' || soleSel.type === 'text')
  const arrowGeom = (o) => connectorEnds(o, objs)
  const arrowD = (o) => {
    const { p1, p2, side1, side2 } = connectorEnds(o, objs)
    const shape = o.shape || 'elbow'
    if (shape === 'straight') return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`
    if (shape === 'curved') {
      const d1 = SIDE_DIR[side1 || 'r'] || [0, 0], d2 = SIDE_DIR[side2 || 'l'] || [0, 0]
      const dd = Math.hypot(p2.x - p1.x, p2.y - p1.y); const k = Math.max(40, dd * 0.4)
      const c1 = { x: p1.x + d1[0] * k, y: p1.y + d1[1] * k }, c2 = { x: p2.x + d2[0] * k, y: p2.y + d2[1] * k }
      return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`
    }
    if (side1 && side2) {
      const d1 = SIDE_DIR[side1] || [0, 0], d2 = SIDE_DIR[side2] || [0, 0]
      const a = { x: p1.x + d1[0] * 26, y: p1.y + d1[1] * 26 }, b = { x: p2.x + d2[0] * 26, y: p2.y + d2[1] * 26 }
      const mid = (o.mid && typeof o.mid === 'object') ? o.mid : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      return roundedPath(elbowPath(p1, side1, p2, side2, mid))
    }
    return roundedPath([p1, p2])
  }
  const effMid = (o) => {
    if (o.mid && typeof o.mid === 'object') return o.mid
    const g = connectorEnds(o, objs); const d1 = SIDE_DIR[g.side1 || 'r'], d2 = SIDE_DIR[g.side2 || 'l']
    const a = { x: g.p1.x + d1[0] * 26, y: g.p1.y + d1[1] * 26 }, b = { x: g.p2.x + d2[0] * 26, y: g.p2.y + d2[1] * 26 }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const elbowHandles = (o) => {
    const g = connectorEnds(o, objs); const mid = effMid(o)
    const pts = elbowPath(g.p1, g.side1, g.p2, g.side2, mid)
    let vh = null, hh = null
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1]
      if (Math.abs(A.x - B.x) < 0.5 && Math.abs(A.x - mid.x) < 0.5 && Math.abs(A.y - B.y) > 8) vh = { x: mid.x, y: (A.y + B.y) / 2 }
      if (Math.abs(A.y - B.y) < 0.5 && Math.abs(A.y - mid.y) < 0.5 && Math.abs(A.x - B.x) > 8) hh = { x: (A.x + B.x) / 2, y: mid.y }
    }
    return { vh, hh }
  }
  const hoverObj = hoverId ? objs[hoverId] : null
  const anchObj = (hoverObj && CONNECTABLE(hoverObj.type)) ? hoverObj
    : (soleSel && CONNECTABLE(soleSel.type)) ? soleSel : null

  return (
    <div ref={vpRef}
      className={'viewport ' + (panning ? 'panning ' : '') + (tool === 'select' ? (spaceRef.current ? 'pan ' : '') : 'tool ')}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onContextMenu={(e) => { e.preventDefault(); const hid = e.target.closest('[data-id]')?.dataset.id; if (hid) { setSelSingle(hid); setHoverId(null); setCommentFor(null); setMenu({ id: hid, x: e.clientX, y: e.clientY }) } else setMenu(null) }}
      onDoubleClick={(e) => {
        // edita clicando em QUALQUER ponto de dentro (área inteira, não só a borda)
        const wp = toWorld(e.clientX, e.clientY)
        const all = Object.values(objsRef.current).filter(o => o.type !== 'arrow' && o.type !== 'pen')
        for (let i = all.length - 1; i >= 0; i--) {
          const o = all[i], b = bboxOf(o)
          if (wp.x >= b.x && wp.x <= b.x + b.w && wp.y >= b.y && wp.y <= b.y + b.h) { setSelSingle(o.id); startEdit(o.id); break }
        }
      }}>
      <BgDots view={view} />
      <div className="world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.z})` }}>
        <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>{[...new Set([...PEER_COLORS, ...NOTE_COLORS, ...CONN_COLORS])].map(c => (<marker key={c} id={'ah' + c.replace('#', '')} markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill={c} /></marker>))}</defs>
          {Object.values(objs).filter(o => o.type === 'arrow').map(o => { const dPath = arrowD(o); return (<g key={o.id}>
            <path data-id={o.id} d={dPath} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke' }} />
            {selIds.has(o.id) && <path d={dPath} fill="none" stroke="#8a76ac" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" opacity="0.4" style={{ pointerEvents: 'none' }} />}
            <path d={dPath} fill="none" stroke={o.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#ah${o.color.replace('#', '')})`} style={{ pointerEvents: 'none' }} />
          </g>) })}
          {Object.values(objs).filter(o => o.type === 'pen').map(o => (<g key={o.id}>
            {selIds.has(o.id) && <polyline points={o.points.map(p => p.join(',')).join(' ')} fill="none" stroke="#8a76ac" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" opacity="0.4" style={{ pointerEvents: 'none' }} />}
            <polyline data-id={o.id} points={o.points.map(p => p.join(',')).join(' ')} fill="none" stroke={o.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'stroke' }} />
          </g>))}
        </svg>

        {Object.values(objs).filter(o => o.type !== 'arrow' && o.type !== 'pen').map(o => {
          const framed = showFrame && soleSel.id === o.id
          const selCls = ((selIds.has(o.id) && !framed) ? ' selected' : '') + (connTarget === o.id ? ' conn-target' : '')
          const rotT = o.rot ? `rotate(${o.rot}deg)` : undefined
          if (o.type === 'sticky') return (<div key={o.id} data-id={o.id} className={'obj sticky' + selCls} style={{ left: o.x, top: o.y, width: o.w, height: o.h, background: o.color, transform: rotT }}>
            <Rich o={o} editing={editing === o.id} editRef={editRef} className="sticky-rt" style={textStyle(o)} ph="" onChange={(p) => livePatch(o.id, p)} onBlur={() => endEdit(o.id)} />{cbadge(o)}
          </div>)
          if (o.type === 'text') return (<div key={o.id} data-id={o.id} className={'obj text-obj' + selCls} style={{ left: o.x, top: o.y, width: o.w || 200, height: o.h || 50, color: o.color, transform: rotT, ...textStyle(o) }}>
            <Rich o={o} editing={editing === o.id} editRef={editRef} className="text-rt" ph="texto" onChange={(p) => livePatch(o.id, p)} onBlur={() => endEdit(o.id)} />{cbadge(o)}
          </div>)
          return (<div key={o.id} data-id={o.id} className={'obj shape' + selCls} style={{ left: o.x, top: o.y, width: o.w, height: o.h, '--sh': o.color, '--fill': o.color + '22', borderRadius: o.type === 'ellipse' ? '50%' : 10, transform: rotT }}>
            <div className="shape-text-wrap"><Rich o={o} editing={editing === o.id} editRef={editRef} className="shape-text" style={textStyle(o)} ph={editing === o.id ? 'digite…' : ''} onChange={(p) => livePatch(o.id, p)} onBlur={() => endEdit(o.id)} /></div>{cbadge(o)}
          </div>)
        })}

        {showFrame && (
          <div className="sel-frame" style={{ left: soleSel.x, top: soleSel.y, width: soleSel.w, height: soleSel.h, transform: soleSel.rot ? `rotate(${soleSel.rot}deg)` : undefined }}>
            <span className="sel-rot" data-rotate="1" />
            <span className="sel-h nw" data-handle="nw" />
            <span className="sel-h ne" data-handle="ne" />
            <span className="sel-h sw" data-handle="sw" />
            <span className="sel-h se" data-handle="se" />
          </div>
        )}
        {anchObj && (
          <div className="anchors" style={{ left: anchObj.x, top: anchObj.y, width: anchObj.w, height: anchObj.h }}>
            <span className="anchor a-t" data-anchor="t" data-aid={anchObj.id} title="Puxar conector" />
            <span className="anchor a-r" data-anchor="r" data-aid={anchObj.id} title="Puxar conector" />
            <span className="anchor a-b" data-anchor="b" data-aid={anchObj.id} title="Puxar conector" />
            <span className="anchor a-l" data-anchor="l" data-aid={anchObj.id} title="Puxar conector" />
          </div>
        )}
        {soleSel && soleSel.type === 'arrow' && (() => { const g = connectorEnds(soleSel, objs); return (<React.Fragment>
          <span className="eph" data-eph="start" style={{ left: g.p1.x, top: g.p1.y }} />
          <span className="eph" data-eph="end" style={{ left: g.p2.x, top: g.p2.y }} />
        </React.Fragment>) })()}
        {soleSel && soleSel.type === 'arrow' && (soleSel.shape || 'elbow') === 'elbow' && soleSel.a1 && soleSel.a2 && (() => { const H = elbowHandles(soleSel); return (<React.Fragment>
          {H.vh && <span className="seg-h" data-seg="x" style={{ left: H.vh.x, top: H.vh.y }} />}
          {H.hh && <span className="seg-h" data-seg="y" style={{ left: H.hh.x, top: H.hh.y }} />}
        </React.Fragment>) })()}
        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      </div>

      {Object.values(cursors).filter(c => c.id !== meId && peers[c.id]).map(c => (
        <div key={c.id} className="cursor" style={{ transform: `translate(${view.x + c.x * view.z}px, ${view.y + c.y * view.z}px)` }}>
          <svg width="22" height="22" viewBox="0 0 22 22"><path d="M3,2 L3,17 L7.5,13 L10.5,20 L13,19 L10,12 L16,12 Z" fill={c.color} stroke="#160f2b" strokeWidth="1" /></svg>
          <div className="label" style={{ background: c.color, color: '#160f2b' }}>{c.name}</div>
        </div>
      ))}

      <div className="topbar">
        <div className="brand">
          <button className="back-btn" title="Voltar" onPointerDown={(e) => e.stopPropagation()} onClick={onExit}>←</button>
          <span className="brand-logo"><OmniaLogo /></span>
          <span className="board-name">{boardName}</span>
        </div>
        <div className="top-right">
          <div className="presence">
            {[{ id: meId, name, color: meColor }, ...others.map(([id, u]) => ({ id, ...u }))].slice(0, 8).map(u => (
              <div key={u.id} className="ava" title={u.id === meId ? name + ' (você)' : u.name} style={{ background: u.color }}>{(u.name || '?').slice(0, 1).toUpperCase()}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="tb-btn" title="Desfazer (Ctrl+Z)" onClick={doUndo}>↶</button>
        <button className="tb-btn" title="Refazer (Ctrl+Shift+Z)" onClick={doRedo}>↷</button>
        <div className="tb-sep" />
        {TOOLS.map(([t, ic, label]) => (<button key={t} className={'tb-btn' + (tool === t ? ' active' : '')} title={label} onClick={() => setTool(t)}>{t === 'select' ? <CursorIcon /> : t === 'sticky' ? <span className="ic-postit" /> : ic}</button>))}
        <div className="tb-sep" />
        <div className="colors">{NOTE_COLORS.map(c => <div key={c} className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setSelColor(c)} />)}</div>
      </div>

      <div className="zoombar" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => zoomTo(clamp(view.z / 1.2, 0.15, 4))}>−</button>
        <div className="z">{Math.round(view.z * 100)}%</div>
        <button onClick={() => zoomTo(clamp(view.z * 1.2, 0.15, 4))}>+</button>
        <button onClick={() => setView({ x: 0, y: 0, z: 1 })} title="Resetar">⤢</button>
      </div>

      {editing && objs[editing] && (() => { const eo = objs[editing]; const bx = clamp(view.x + eo.x * view.z, 8, window.innerWidth - 130); const by = Math.max(8, view.y + eo.y * view.z - 46); return (
        <div className="fmtbar" style={{ left: bx, top: by }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => mutate(editing, o => ({ ...o, fontSize: clamp((o.fontSize || defFont(o)) - 2, 10, 120) }))} title="Diminuir letra">A−</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => mutate(editing, o => ({ ...o, fontSize: clamp((o.fontSize || defFont(o)) + 2, 10, 120) }))} title="Aumentar letra">A+</button>
          <span className="fmt-sep" />
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => applyFmt('bold')} style={{ fontWeight: 800 }} title="Negrito (Ctrl+B)">B</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => applyFmt('italic')} style={{ fontStyle: 'italic', fontFamily: 'Georgia,serif' }} title="Itálico (Ctrl+I)">i</button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => applyFmt('underline')} style={{ textDecoration: 'underline' }} title="Sublinhar">U</button>
        </div>
      ) })()}

      {menu && objs[menu.id] && (() => { const m = objs[menu.id]; const hasText = m.type === 'sticky' || m.type === 'rect' || m.type === 'ellipse' || m.type === 'text'; return (
        <div className="ctxmenu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 220) }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          {hasText && (
            <div className="ctx-row">
              <span className="ctx-lbl">Tamanho</span>
              <div className="ctx-seg">
                <button title="Diminuir" onClick={() => mutate(menu.id, o => ({ ...o, fontSize: clamp((o.fontSize || defFont(o)) - 2, 10, 96) }))}>A−</button>
                <button title="Aumentar" onClick={() => mutate(menu.id, o => ({ ...o, fontSize: clamp((o.fontSize || defFont(o)) + 2, 10, 96) }))}>A+</button>
              </div>
            </div>
          )}
          <div className="ctx-row">
            <span className="ctx-lbl">Cor</span>
            <div className="ctx-colors">{NOTE_COLORS.map(c => <span key={c} className={'ctx-sw' + (m.color === c ? ' on' : '')} style={{ background: c }} onClick={() => mutate(menu.id, o => ({ ...o, color: c }))} />)}</div>
          </div>
          <button className="ctx-item" onClick={() => { setCommentText(''); setCommentFor({ id: menu.id, x: menu.x, y: menu.y }); setMenu(null) }}>💬 Adicionar comentário</button>
          <button className="ctx-item danger" onClick={() => { const o = objsRef.current[menu.id]; applyOp({ t: 'del', id: menu.id }); if (o) pushHist({ t: 'up', o }, { t: 'del', id: menu.id }); setSelIds(new Set()); setMenu(null) }}>🗑 Apagar</button>
        </div>
      ) })()}

      {soleSel && soleSel.type === 'arrow' && (() => { const g = connectorEnds(soleSel, objs); const mx = (g.p1.x + g.p2.x) / 2, my = (g.p1.y + g.p2.y) / 2; const bx = clamp(view.x + mx * view.z - 100, 8, window.innerWidth - 220); const by = Math.max(8, view.y + my * view.z - 52); const sh = soleSel.shape || 'elbow'; return (
        <div className="connbar" style={{ left: bx, top: by }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button className={sh === 'straight' ? 'on' : ''} title="Reta" onClick={() => mutate(soleSel.id, o => ({ ...o, shape: 'straight' }))}>╱</button>
          <button className={sh === 'curved' ? 'on' : ''} title="Curva" onClick={() => mutate(soleSel.id, o => ({ ...o, shape: 'curved' }))}>⌒</button>
          <button className={sh === 'elbow' ? 'on' : ''} title="Cotovelo" onClick={() => mutate(soleSel.id, o => ({ ...o, shape: 'elbow' }))}>⌐</button>
          <span className="fmt-sep" />
          {CONN_COLORS.map(c => <span key={c} className={'connsw' + (soleSel.color === c ? ' on' : '')} style={{ background: c }} onClick={() => mutate(soleSel.id, o => ({ ...o, color: c }))} />)}
          <span className="fmt-sep" />
          <button title="Apagar" onClick={() => { const o = objsRef.current[soleSel.id]; applyOp({ t: 'del', id: soleSel.id }); if (o) pushHist({ t: 'up', o }, { t: 'del', id: soleSel.id }); setSelIds(new Set()) }}>🗑</button>
        </div>
      ) })()}

      {commentFor && objs[commentFor.id] && (
        <div className="cmenu" style={{ left: Math.min(commentFor.x, window.innerWidth - 280), top: Math.min(commentFor.y, window.innerHeight - 260) }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <div className="cmenu-head">Comentários</div>
          <div className="clist">
            {(objs[commentFor.id].comments || []).map(c => <div key={c.id} className="citem"><b>{c.author}</b> {c.text}</div>)}
            {!(objs[commentFor.id].comments || []).length && <div className="cempty">Nenhum comentário ainda.</div>}
          </div>
          <textarea className="cinput" autoFocus placeholder="Escreva um comentário…" value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = commentText.trim(); if (t) { mutate(commentFor.id, o => ({ ...o, comments: [...(o.comments || []), { id: uid(), author: name, text: t }] })); setCommentText('') } } }} />
          <div className="crow">
            <button className="btn" onClick={() => setCommentFor(null)}>Fechar</button>
            <button className="btn primary" onClick={() => { const t = commentText.trim(); if (!t) return; mutate(commentFor.id, o => ({ ...o, comments: [...(o.comments || []), { id: uid(), author: name, text: t }] })); setCommentText('') }}>Comentar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function BgDots({ view }) {
  const gap = 28 * view.z, ox = ((view.x % gap) + gap) % gap, oy = ((view.y % gap) + gap) % gap
  return <div className="dots" style={{ backgroundImage: 'radial-gradient(rgba(43,35,51,.16) 1.3px, transparent 1.3px)', backgroundSize: `${gap}px ${gap}px`, backgroundPosition: `${ox}px ${oy}px` }} />
}

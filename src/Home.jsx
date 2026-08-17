import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

export default function Home({ user, onOpenBoard }) {
  const [folders, setFolders] = useState([])
  const [boards, setBoards] = useState([])
  const [sel, setSel] = useState('all')
  const [loading, setLoading] = useState(true)
  const [shareBoard, setShareBoard] = useState(null)
  const [moveBoard, setMoveBoard] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, b] = await Promise.all([
      supabase.from('folders').select('*').order('name'),
      supabase.from('boards').select('id,name,folder_id,updated_at,created_by').order('updated_at', { ascending: false }),
    ])
    setFolders(f.data || []); setBoards(b.data || []); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const newFolder = async () => {
    const name = prompt('Nome do cliente / pasta:'); if (!name) return
    const { data, error } = await supabase.from('folders').insert({ name, created_by: user.id }).select().single()
    if (data) { setFolders(f => [...f, data].sort((a, b) => a.name.localeCompare(b.name))); setSel(data.id) }
    else alert('Não deu pra criar a pasta: ' + (error?.message || ''))
  }
  const newBoard = async () => {
    const name = prompt('Nome do quadro:', 'Novo quadro') || 'Novo quadro'
    const folder_id = sel === 'all' ? null : sel
    const { data, error } = await supabase.from('boards').insert({ name, folder_id, created_by: user.id }).select().single()
    if (data) onOpenBoard(data.id); else alert('Não deu pra criar o quadro: ' + (error?.message || ''))
  }
  const renameBoard = async (bd) => { const name = prompt('Renomear quadro:', bd.name); if (!name) return; await supabase.from('boards').update({ name }).eq('id', bd.id); setBoards(bs => bs.map(x => x.id === bd.id ? { ...x, name } : x)) }
  const delBoard = async (bd) => { if (!confirm('Apagar o quadro "' + bd.name + '"? Isso não tem volta.')) return; await supabase.from('boards').delete().eq('id', bd.id); setBoards(bs => bs.filter(x => x.id !== bd.id)) }
  const moveTo = async (bd, folder_id) => {
    setMoveBoard(null); setDragOver(null)
    setBoards(bs => bs.map(x => x.id === bd.id ? { ...x, folder_id } : x)) // otimista
    const { error } = await supabase.from('boards').update({ folder_id }).eq('id', bd.id)
    if (error) { alert('Não deu pra mover: ' + error.message); load() }
  }
  const onDropFolder = (folderId) => (e) => {
    e.preventDefault(); setDragOver(null)
    const id = e.dataTransfer.getData('board')
    const bd = boards.find(b => b.id === id)
    if (bd && bd.folder_id !== folderId) moveTo(bd, folderId)
  }

  const visible = boards.filter(b => sel === 'all' || b.folder_id === sel)
  const canManage = (bd) => user.is_admin || bd.created_by === user.id

  return (
    <div className="home">
      <aside className="side">
        <div className="side-brand"><img className="brand-img" src="/logo.png" alt="omnia.board" /></div>
        <button
          className={'side-item' + (sel === 'all' ? ' on' : '') + (dragOver === 'root' ? ' drop' : '')}
          onClick={() => setSel('all')}
          onDragOver={(e) => { e.preventDefault(); setDragOver('root') }}
          onDragLeave={() => setDragOver(d => d === 'root' ? null : d)}
          onDrop={onDropFolder(null)}
        >🗂️ Todos os quadros</button>
        <div className="side-label"><span>Clientes</span>{user.is_admin && <button className="mini" onClick={newFolder}>+ pasta</button>}</div>
        <div className="side-folders">
          {folders.map(f => (
            <button key={f.id}
              className={'side-item' + (sel === f.id ? ' on' : '') + (dragOver === f.id ? ' drop' : '')}
              onClick={() => setSel(f.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(f.id) }}
              onDragLeave={() => setDragOver(d => d === f.id ? null : d)}
              onDrop={onDropFolder(f.id)}
            >📁 {f.name}</button>
          ))}
          {!folders.length && <div className="side-empty">nenhuma pasta ainda</div>}
        </div>
        <div className="side-user">
          <div className="ava-sm">{(user.name || '?').slice(0, 1).toUpperCase()}</div>
          <div className="side-user-info"><b>{user.name} {user.is_admin && <span className="badge">admin</span>}</b><div className="side-email">{user.email}</div></div>
          <button className="mini" onClick={() => supabase.auth.signOut()}>sair</button>
        </div>
      </aside>

      <main className="main">
        <div className="main-head">
          <h1>{sel === 'all' ? 'Todos os quadros' : (folders.find(f => f.id === sel)?.name || 'Pasta')}</h1>
          <button className="btn primary" onClick={newBoard}>+ Novo quadro</button>
        </div>
        {loading ? <div className="muted">Carregando…</div> : (
          <div className="board-grid">
            {visible.map(bd => (
              <div key={bd.id} className="board-card"
                draggable={canManage(bd)}
                onDragStart={(e) => { e.dataTransfer.setData('board', bd.id); e.dataTransfer.effectAllowed = 'move' }}
                onClick={() => onOpenBoard(bd.id)}>
                <div className="board-thumb">▦</div>
                <div className="board-meta">
                  <div className="board-title">{bd.name}</div>
                  <div className="board-sub">{bd.folder_id ? (folders.find(f => f.id === bd.folder_id)?.name || '—') : 'sem pasta'}</div>
                </div>
                {canManage(bd) && (
                  <div className="board-actions" onClick={(e) => e.stopPropagation()}>
                    <button title="Mover para pasta" onClick={() => setMoveBoard(bd)}>📁</button>
                    <button title="Compartilhar" onClick={() => setShareBoard(bd)}>👥</button>
                    <button title="Renomear" onClick={() => renameBoard(bd)}>✏️</button>
                    <button title="Apagar" onClick={() => delBoard(bd)}>🗑️</button>
                  </div>
                )}
              </div>
            ))}
            {!visible.length && <div className="muted">Nenhum quadro aqui ainda. Crie o primeiro 👆</div>}
          </div>
        )}
      </main>

      {shareBoard && <ShareModal board={shareBoard} user={user} onClose={() => setShareBoard(null)} />}

      {moveBoard && (
        <div className="modal-bg" onClick={() => setMoveBoard(null)}>
          <div className="modal share" onClick={(e) => e.stopPropagation()}>
            <h1>Mover “{moveBoard.name}”</h1>
            <p>Escolha a pasta (cliente). Dica: também dá pra arrastar o card direto pra pasta na lateral.</p>
            <div className="member-list">
              <button className={'move-opt' + (!moveBoard.folder_id ? ' on' : '')} onClick={() => moveTo(moveBoard, null)}>🗂️ Sem pasta</button>
              {folders.map(f => (
                <button key={f.id} className={'move-opt' + (moveBoard.folder_id === f.id ? ' on' : '')} onClick={() => moveTo(moveBoard, f.id)}>📁 {f.name}</button>
              ))}
              {!folders.length && <div className="muted" style={{ padding: '8px 0' }}>Você ainda não criou nenhuma pasta.</div>}
            </div>
            <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={() => setMoveBoard(null)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ShareModal({ board, onClose }) {
  const [members, setMembers] = useState([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { const { data } = await supabase.from('board_members').select('user_id, profiles(name,email)').eq('board_id', board.id); setMembers(data || []) }, [board.id])
  useEffect(() => { load() }, [load])
  const add = async () => {
    const em = email.trim().toLowerCase(); if (!em) return
    setBusy(true); setMsg('')
    const { data: prof } = await supabase.from('profiles').select('id').eq('email', em).maybeSingle()
    if (!prof) { setMsg('Essa pessoa ainda não tem conta — peça pra ela entrar 1x no Omnia Board, depois convide.'); setBusy(false); return }
    const { error } = await supabase.from('board_members').insert({ board_id: board.id, user_id: prof.id })
    setBusy(false)
    if (error && !String(error.message).includes('duplicate')) setMsg('Erro: ' + error.message); else { setEmail(''); load() }
  }
  const remove = async (uid) => { await supabase.from('board_members').delete().eq('board_id', board.id).eq('user_id', uid); load() }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal share" onClick={(e) => e.stopPropagation()}>
        <h1>Compartilhar “{board.name}”</h1>
        <p>Convide pessoas por e-mail. O admin já vê todos os quadros.</p>
        <div className="share-add">
          <input placeholder="email@omniamarketing.com.br" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="btn primary" onClick={add} disabled={busy}>Convidar</button>
        </div>
        {msg && <div className="share-msg">{msg}</div>}
        <div className="member-list">
          {members.map(m => (<div key={m.user_id} className="member"><span>{m.profiles?.name || m.profiles?.email}</span><button onClick={() => remove(m.user_id)}>remover</button></div>))}
          {!members.length && <div className="muted" style={{ padding: '8px 0' }}>Ninguém convidado ainda.</div>}
        </div>
        <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>Fechar</button>
      </div>
    </div>
  )
}

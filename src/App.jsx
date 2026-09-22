import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import Auth from './Auth'
import Home from './Home'
import Board from './Board'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [erroLink, setErroLink] = useState('')
  const [route, setRoute] = useState(() => new URLSearchParams(location.search).get('board'))
  const [boardName, setBoardName] = useState('Quadro')

  useEffect(() => {
    // O link do email vem como ?acesso=<token>. Trocamos o token por sessão
    // aqui mesmo, em vez de deixar o Supabase redirecionar: assim o acesso
    // não depende da lista de Redirect URLs do painel.
    const token = new URLSearchParams(location.search).get('acesso')
    if (token) {
      supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' }).then(({ data, error }) => {
        const u = new URL(location)
        u.searchParams.delete('acesso')
        history.replaceState({}, '', u)
        if (error) {
          setErroLink('Esse link já foi usado ou expirou. Peça outro abaixo.')
          setSession(null)
        } else {
          setSession(data.session)
        }
      })
    } else {
      supabase.auth.getSession().then(({ data }) => setSession(data.session))
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    const onPop = () => setRoute(new URLSearchParams(location.search).get('board'))
    window.addEventListener('popstate', onPop)
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('popstate', onPop) }
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    let alive = true
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => { if (alive) setProfile(data) })
    return () => { alive = false }
  }, [session])

  useEffect(() => {
    if (!route) { setBoardName('Quadro'); return }
    supabase.from('boards').select('name').eq('id', route).maybeSingle().then(({ data }) => setBoardName(data?.name || 'Quadro'))
  }, [route])

  const openBoard = useCallback((id) => { const u = new URL(location); u.searchParams.set('board', id); history.pushState({}, '', u); setRoute(id) }, [])
  const exitBoard = useCallback(() => { const u = new URL(location); u.searchParams.delete('board'); history.pushState({}, '', u); setRoute(null) }, [])

  if (session === undefined) return <div className="fullscreen center"><div className="spinner" /></div>
  if (!session) return <Auth aviso={erroLink} />
  const user = { id: session.user.id, email: session.user.email, name: profile?.name || session.user.email.split('@')[0], is_admin: !!profile?.is_admin }
  if (route) return <Board key={route} boardId={route} boardName={boardName} user={user} onExit={exitBoard} />
  return <Home user={user} onOpenBoard={openBoard} />
}

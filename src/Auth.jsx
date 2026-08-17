import React, { useState } from 'react'
import { supabase } from './supabase'

const DOMAIN = '@omniamarketing.com.br'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e?.preventDefault()
    const em = email.trim().toLowerCase()
    if (!em.endsWith(DOMAIN)) { setErr('Use seu e-mail ' + DOMAIN); return }
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin } })
    setBusy(false)
    if (error) setErr(error.message); else setSent(true)
  }

  return (
    <div className="auth-bg">
      <div className="auth-inner">
        <div className="auth-brand"><img className="brand-img" src="/logo.png" alt="omnia.board" /></div>
        <div className="auth-card">
          {sent ? (
            <>
              <div className="auth-emoji">📬</div>
              <h1>Link enviado!</h1>
              <p>Abra o e-mail que mandamos pra <b>{email}</b> e clique no link pra entrar. Pode fechar esta aba.</p>
              <button className="btn" style={{ width: '100%' }} onClick={() => setSent(false)}>Usar outro e-mail</button>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1>Entrar</h1>
              <p>Quadro branco colaborativo da Omnia. Use seu e-mail da empresa — mandamos um link mágico (sem senha).</p>
              <input autoFocus type="email" placeholder={'voce' + DOMAIN} value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} />
              {err && <div className="auth-err">{err}</div>}
              <button className="btn primary" style={{ width: '100%' }} disabled={busy} type="submit">{busy ? 'Enviando…' : 'Enviar link de acesso'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { supabase } from './supabase'

const DOMAIN = '@omniamarketing.com.br'

/**
 * Login por link no e-mail.
 *
 * Antes daqui, o Board entrava com `signInWithPassword` usando o próprio
 * e-mail como senha. Era instantâneo, mas tinha dois problemas sérios:
 *
 *   1. Toda conta ficava com senha adivinhável. E como o Board divide o
 *      mesmo projeto Supabase com o Post Planner, essas contas também
 *      abriam o Post Planner, que publica nas redes reais dos clientes.
 *   2. Quem já tinha senha de verdade (definida no Post Planner) não
 *      conseguia mais entrar, e o app culpava um SQL que não tinha nada
 *      a ver com o erro.
 *
 * Agora pedimos um link pra edge function `board-access`, que valida o
 * domínio no servidor e manda o e-mail pelo Microsoft Graph — o mesmo
 * caminho dos outros e-mails da Omnia. O mailer nativo do Supabase não
 * serve aqui: tem limite baixo de envio e cai em spam.
 */
export default function Auth({ aviso = '' }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(aviso)
  const [enviado, setEnviado] = useState('')

  const submit = async (e) => {
    e?.preventDefault()
    const em = email.trim().toLowerCase()
    if (!em.endsWith(DOMAIN)) { setErr('Use seu e-mail ' + DOMAIN); return }
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.functions.invoke('board-access', {
        body: { email: em, redirectTo: window.location.origin },
      })
      // A supabase-js descarta o corpo em resposta não-2xx, então o motivo
      // real vem por aqui quando dá ruim.
      const motivo = error ? await lerErro(error) : data?.error
      if (motivo) throw new Error(motivo)
      setEnviado(em)
    } catch (e2) {
      setErr(e2?.message || 'Não deu pra enviar o link agora')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-inner">
        <div className="auth-brand"><img className="brand-img" src="/logo.png" alt="omnia.board" /></div>
        <div className="auth-card">
          {enviado ? (
            <div>
              <h1>Olha seu e-mail</h1>
              <p>
                Mandei um link de entrada pra <strong>{enviado}</strong>. É só clicar
                que você entra direto — o link vale por pouco tempo e serve uma vez só.
              </p>
              <button
                className="btn"
                style={{ width: '100%' }}
                onClick={() => { setEnviado(''); setErr('') }}
              >
                Usar outro e-mail
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <h1>Entrar</h1>
              <p>
                Quadro branco colaborativo da Omnia. Coloque seu e-mail da empresa
                que a gente manda um link de entrada — sem senha pra decorar.
              </p>
              <input
                autoFocus
                type="email"
                placeholder={'voce' + DOMAIN}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErr('') }}
              />
              {err && <div className="auth-err">{err}</div>}
              <button className="btn primary" style={{ width: '100%' }} disabled={busy} type="submit">
                {busy ? 'Enviando…' : 'Receber link de acesso'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

/** Extrai a mensagem que a edge function devolveu no corpo do erro. */
async function lerErro(error) {
  const ctx = error?.context
  if (ctx && typeof ctx.text === 'function') {
    try {
      const bruto = await ctx.text()
      const parsed = JSON.parse(bruto)
      return parsed?.error || bruto
    } catch {
      /* corpo ilegível — cai na mensagem genérica abaixo */
    }
  }
  return error?.message || 'Não deu pra enviar o link agora'
}

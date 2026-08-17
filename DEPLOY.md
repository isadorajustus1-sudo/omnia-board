# Omnia Board — colocar no ar (com login, pastas e permissões)

App de quadro branco colaborativo (tipo Miro) da Omnia. React + Vite + Supabase (Auth + Realtime + Postgres).

## Rodar local
```
cd omnia-board
npm install
npm run dev        # http://localhost:5180
```

## Passo 1 — Banco (rodar o SQL)
Supabase → **SQL Editor** → cole e rode todo o `supabase-setup.sql`.
Cria: `profiles`, `folders` (clientes), `boards`, `board_members` + as regras de acesso (RLS) e o gatilho que faz **isadora@omniamarketing.com.br** virar admin automaticamente no 1º login.

## Passo 2 — Login (Supabase Auth)
No Supabase → **Authentication**:
1. **Providers → Email**: ligado (é o padrão). É o login por link mágico.
2. **URL Configuration**:
   - **Site URL**: a URL do app (ex.: `https://omnia-board.vercel.app`). Pra testar local, pode usar `http://localhost:5180`.
   - **Redirect URLs**: adicione **as duas** — `http://localhost:5180` e a URL do Vercel. Sem isso o link do e-mail não volta pro app.
3. (Opcional, recomendado depois) **SMTP próprio**: o e-mail padrão do Supabase tem limite baixo e às vezes cai no spam. Pra uso real da equipe, configure um SMTP (ex.: o e-mail da Omnia). Sem isso funciona, mas com limite.

## Passo 3 — Deploy no Vercel
Variáveis de ambiente (já no `.env` local):
- `VITE_SUPABASE_URL` = https://soekfeaohvoznbadmkca.supabase.co
- `VITE_SUPABASE_PUBLISHABLE_KEY` = sb_publishable_ctun6DaKNVWIa-eI1X9_jQ_hjWfInfG

**Via GitHub (recomendado):** suba a pasta `omnia-board` num repo → Vercel → Import → framework Vite (auto) → adicione as 2 variáveis → Deploy.
**Via CLI:** `npm i -g vercel` → `cd omnia-board` → `vercel` → adicione as 2 env vars → `vercel --prod`.
> Depois de saber a URL do Vercel, volte no Passo 2 e coloque ela em Site URL + Redirect URLs.

## Como funciona
- **Login**: cada pessoa entra com o e-mail @omniamarketing.com.br → recebe um link → entra (sem senha).
- **Você (admin)**: vê **todos** os quadros de todos os clientes; cria **pastas** (clientes) e **quadros**; compartilha.
- **Equipe**: vê só os quadros **compartilhados** com ela (e as pastas desses quadros). Cada um edita ao vivo, junto.
- **Compartilhar**: no card do quadro (ícone 👥) → convida por e-mail. ⚠️ A pessoa precisa ter **entrado 1x** no app pra aparecer na busca (aí ela já tem conta).
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z. **Escrever nas formas**: 2 cliques.

## Evolução (quando quiser)
Login Microsoft (@omniamarketing), redimensionar/rotacionar, imagens coláveis, comentários, exportar PNG/PDF, molduras, templates (retrô, kanban), papéis (editor/leitor).

-- ===================================================================
-- Omnia Board — schema completo (login + pastas + quadros + permissões)
-- Rode 1x no SQL Editor do Supabase (projeto soekfeaohvoznbadmkca).
-- Idempotente: pode rodar de novo sem quebrar.
-- ===================================================================

-- ---------- PERFIS ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text unique,
  name       text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- cria o perfil no signup; Isadora vira admin automaticamente
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, is_admin)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    lower(new.email) = 'isadora@omniamarketing.com.br'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- helpers (SECURITY DEFINER = ignoram RLS por dentro, evitam recursão)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- PASTAS (clientes) ----------
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- QUADROS ----------
create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid references public.folders(id) on delete set null,
  name       text not null default 'Novo quadro',
  created_by uuid references public.profiles(id),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------- MEMBROS (compartilhamento) ----------
create table if not exists public.board_members (
  board_id uuid references public.boards(id)   on delete cascade,
  user_id  uuid references public.profiles(id) on delete cascade,
  primary key (board_id, user_id)
);

-- helper que depende das tabelas acima (criado depois delas)
create or replace function public.can_access_board(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.boards        where id = b        and created_by = auth.uid())
      or exists (select 1 from public.board_members where board_id = b  and user_id   = auth.uid());
$$;

-- ---------- RLS ----------
alter table public.profiles      enable row level security;
alter table public.folders       enable row level security;
alter table public.boards        enable row level security;
alter table public.board_members enable row level security;

-- profiles: todos logados leem (pra compartilhar por nome/e-mail); edita o próprio
drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select using (auth.role() = 'authenticated');
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles for update using (id = auth.uid());

-- folders: admin vê todas; os outros só as pastas que têm algum quadro acessível a eles
drop policy if exists p_folders_sel on public.folders;
create policy p_folders_sel on public.folders for select using (
  public.is_admin()
  or exists (select 1 from public.boards b where b.folder_id = folders.id and public.can_access_board(b.id))
);
drop policy if exists p_folders_ins on public.folders;
create policy p_folders_ins on public.folders for insert with check (public.is_admin());
drop policy if exists p_folders_upd on public.folders;
create policy p_folders_upd on public.folders for update using (public.is_admin());
drop policy if exists p_folders_del on public.folders;
create policy p_folders_del on public.folders for delete using (public.is_admin());

-- boards: vê/edita quem tem acesso (admin, criador, membro)
drop policy if exists p_boards_sel on public.boards;
create policy p_boards_sel on public.boards for select using (public.can_access_board(id));
drop policy if exists p_boards_ins on public.boards;
create policy p_boards_ins on public.boards for insert with check (created_by = auth.uid());
drop policy if exists p_boards_upd on public.boards;
create policy p_boards_upd on public.boards for update using (public.can_access_board(id));
drop policy if exists p_boards_del on public.boards;
create policy p_boards_del on public.boards for delete using (public.is_admin() or created_by = auth.uid());

-- board_members: vê admin / o próprio membro / criador do quadro; gerencia admin ou criador
drop policy if exists p_bm_sel on public.board_members;
create policy p_bm_sel on public.board_members for select using (
  public.is_admin() or user_id = auth.uid()
  or exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
);
drop policy if exists p_bm_ins on public.board_members;
create policy p_bm_ins on public.board_members for insert with check (
  public.is_admin() or exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
);
drop policy if exists p_bm_del on public.board_members;
create policy p_bm_del on public.board_members for delete using (
  public.is_admin() or exists (select 1 from public.boards b where b.id = board_id and b.created_by = auth.uid())
);

-- ---------- BACKFILL (quem já logou antes de rodar este SQL) ----------
-- O gatilho só cria perfil em logins NOVOS. Quem já entrou (ex.: você) não
-- teve perfil criado. Este bloco cria o perfil de todo mundo que já está em
-- auth.users e marca a Isadora como admin. Idempotente.
insert into public.profiles (id, email, name, is_admin)
select
  u.id, u.email,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  lower(u.email) = 'isadora@omniamarketing.com.br'
from auth.users u
on conflict (id) do update
  set email    = excluded.email,
      is_admin = public.profiles.is_admin or excluded.is_admin;

-- Dica: se por acaso ainda não vier admin, rode:
--   update public.profiles set is_admin = true where lower(email) = 'isadora@omniamarketing.com.br';

-- 交接事項與教師通知分開保存；所有有效行政角色均可接手。
create table public.handovers (
 id uuid primary key,
 content text not null check (length(trim(content)) between 1 and 2000),
 created_by uuid not null references public.staff(id),
 creator_name text not null,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 completed_by uuid references public.staff(id),
 completed_name text,
 constraint handover_completion_consistent check (
  (completed_at is null and completed_by is null and completed_name is null)
  or (completed_at is not null and completed_by is not null and completed_name is not null)
 )
);
create index handovers_pending_date on public.handovers(created_at desc) where completed_at is null;
create index handovers_completed_date on public.handovers(completed_at desc) where completed_at is not null;
alter table public.handovers enable row level security;
revoke all on public.handovers from public,anon,authenticated;
grant select on public.handovers to authenticated;
grant all on public.handovers to service_role;
create policy handovers_read on public.handovers for select to authenticated
 using ((select public.office_role()) in ('admin','staff'));
alter table public.audit_logs add column handover_id uuid references public.handovers(id);

create function public.handover_command(actor uuid, action text, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor_name text; h public.handovers%rowtype; body text; item_id uuid;
begin
 select display_name into actor_name from public.staff
 where id=actor and active and role in ('admin','staff') for share;
 if not found then raise exception '未授權' using errcode='42501'; end if;
 item_id := (payload->>'id')::uuid;
 if item_id is null then raise exception '缺少交接事項編號'; end if;
 if action='handover_create' then
  body := trim(payload->>'content');
  if body is null or length(body) not between 1 and 2000 then raise exception '請輸入 1 至 2000 字的交接內容'; end if;
  insert into public.handovers(id,content,created_by,creator_name)
  values(item_id,body,actor,actor_name) on conflict(id) do nothing returning * into h;
  if not found then
   select * into h from public.handovers where id=item_id;
   if h.created_by<>actor or h.content<>body then raise exception '重複請求內容不一致'; end if;
   return to_jsonb(h);
  end if;
 elsif action='handover_complete' then
  select * into h from public.handovers where id=item_id for update;
  if not found then raise exception '交接事項不存在'; end if;
  -- 同時完成時保留第一位經辦人與時間，重試不會改寫歷史。
  if h.completed_at is not null then return to_jsonb(h); end if;
  update public.handovers set completed_at=now(),completed_by=actor,completed_name=actor_name
   where id=item_id returning * into h;
 else raise exception '不支援的交接操作'; end if;
 insert into public.audit_logs(actor_id,action,handover_id) values(actor,action,item_id);
 return to_jsonb(h);
end $$;
revoke all on function public.handover_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.handover_command(uuid,text,jsonb) to service_role;
alter publication supabase_realtime add table public.handovers;

-- 內部備註與 LINE 訊息分表保存；交接更正／恢復保留完整快照。
alter table public.handovers add column version integer not null default 1 check(version>0);
create table public.internal_notes (
 id uuid primary key, teacher_id uuid not null references public.teachers(id),
 content text not null check(length(trim(content)) between 1 and 2000),
 author_id uuid not null references public.staff(id), author_name text not null,
 created_at timestamptz not null default now()
);
create index internal_notes_teacher_date on public.internal_notes(teacher_id,created_at desc);
create table public.handover_revisions (
 id uuid primary key default gen_random_uuid(), handover_id uuid not null references public.handovers(id),
 action text not null check(action in ('handover_create','handover_complete','handover_edit','handover_reopen')),
 actor_id uuid not null references public.staff(id), actor_name text not null,
 before_data jsonb, after_data jsonb not null,
 reason text check(length(reason)<=500), created_at timestamptz not null default now()
);
create index handover_revisions_item_date on public.handover_revisions(handover_id,created_at desc);
alter table public.audit_logs add column internal_note_id uuid references public.internal_notes(id);
alter table public.internal_notes enable row level security;
alter table public.handover_revisions enable row level security;
revoke all on public.internal_notes,public.handover_revisions from public,anon,authenticated;
grant select on public.internal_notes,public.handover_revisions to authenticated;
grant all on public.internal_notes,public.handover_revisions to service_role;
create policy internal_notes_read on public.internal_notes for select to authenticated using ((select public.office_role()) in ('admin','staff'));
create policy handover_revisions_read on public.handover_revisions for select to authenticated using ((select public.office_role()) in ('admin','staff'));

create function public.internal_note_command(actor uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor_name text; body text; tid uuid; note public.internal_notes%rowtype;
begin
 select display_name into actor_name from public.staff where id=actor and active and role in ('admin','staff') for share;
 if not found then raise exception '未授權' using errcode='42501'; end if;
 body:=trim(payload->>'content'); tid:=(payload->>'teacher_id')::uuid;
 if body is null or length(body) not between 1 and 2000 then raise exception '請輸入 1 至 2000 字的內部備註'; end if;
 perform 1 from public.teachers where id=tid and active for share;
 if not found then raise exception '教師已停用或不存在'; end if;
 insert into public.internal_notes(id,teacher_id,content,author_id,author_name)
 values((payload->>'id')::uuid,tid,body,actor,actor_name) on conflict(id) do nothing returning * into note;
 if not found then
  select * into note from public.internal_notes where id=(payload->>'id')::uuid;
  if note.author_id<>actor or note.teacher_id<>tid or note.content<>body then raise exception '重複請求內容不一致'; end if;
  return to_jsonb(note);
 end if;
 insert into public.audit_logs(actor_id,action,teacher_id,internal_note_id) values(actor,'internal_note_create',tid,note.id);
 return to_jsonb(note);
end $$;
revoke all on function public.internal_note_command(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_note_command(uuid,jsonb) to service_role;
create or replace function public.handover_command(actor uuid, action text, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor_name text; h public.handovers%rowtype; body text; item_id uuid; entered_name text; before_row jsonb; reason_text text;
begin
 select display_name into actor_name from public.staff
 where id=actor and active and role in ('admin','staff') for share;
 if not found then raise exception '未授權' using errcode='42501'; end if;
 reason_text:=nullif(trim(payload->>'reason'),'');
 if length(reason_text)>500 then raise exception '原因最多 500 字'; end if;
 item_id := (payload->>'id')::uuid;
 if item_id is null then raise exception '缺少交接事項編號'; end if;
 if action='handover_create' then
  body := trim(payload->>'content');
  if body is null or length(body) not between 1 and 2000 then raise exception '請輸入 1 至 2000 字的交接內容'; end if;
  entered_name:=trim(payload->>'handover_name');
  if entered_name is null or length(entered_name) not between 1 and 80 then raise exception '請填寫 1 至 80 字的交接人姓名'; end if;
  insert into public.handovers(id,content,created_by,creator_name,handover_name)
  values(item_id,body,actor,actor_name,entered_name) on conflict(id) do nothing returning * into h;
  if not found then
   select * into h from public.handovers where id=item_id;
   if h.created_by<>actor or h.content<>body or h.handover_name<>entered_name then raise exception '重複請求內容不一致'; end if;
   return to_jsonb(h);
  end if;
 elsif action='handover_complete' then
  select * into h from public.handovers where id=item_id for update;
  if not found then raise exception '交接事項不存在'; end if;
  -- 同時完成時保留第一位經辦人與時間，重試不會改寫歷史。
  if h.completed_at is not null then return to_jsonb(h); end if;
  if payload ? 'expected_version' and (payload->>'expected_version')::integer is distinct from h.version then raise exception '交接事項已被更新，請重新整理後再操作' using errcode='40001'; end if;
  before_row:=to_jsonb(h);
  entered_name:=trim(payload->>'finisher_name');
  if entered_name is null or length(entered_name) not between 1 and 80 then raise exception '請填寫 1 至 80 字的完成人姓名'; end if;
  update public.handovers set completed_at=now(),completed_by=actor,completed_name=actor_name,finisher_name=entered_name,version=version+1
   where id=item_id returning * into h;
 elsif action in ('handover_edit','handover_reopen') then
  select * into h from public.handovers where id=item_id for update;
  if not found then raise exception '交接事項不存在'; end if;
  if action='handover_reopen' and h.completed_at is null then return to_jsonb(h); end if;
  if (payload->>'expected_version')::integer is distinct from h.version then
   raise exception '交接事項已被更新，請重新整理後再操作' using errcode='40001';
  end if;
  before_row:=to_jsonb(h);
  if action='handover_edit' then
   body:=trim(payload->>'content');entered_name:=trim(payload->>'handover_name');
   if body is null or length(body) not between 1 and 2000 then raise exception '請輸入 1 至 2000 字的交接內容'; end if;
   if entered_name is null or length(entered_name) not between 1 and 80 then raise exception '請填寫 1 至 80 字的交接人姓名'; end if;
   if h.completed_at is not null and (nullif(trim(payload->>'finisher_name'),'') is null or length(trim(payload->>'finisher_name'))>80) then raise exception '請填寫 1 至 80 字的完成人姓名'; end if;
   if h.content=body and h.handover_name=entered_name and (h.completed_at is null or h.finisher_name=trim(payload->>'finisher_name')) then return to_jsonb(h); end if;
   update public.handovers set content=body,handover_name=entered_name,
    finisher_name=case when completed_at is not null then trim(payload->>'finisher_name') end,version=version+1
    where id=item_id returning * into h;
  else
   update public.handovers set completed_at=null,completed_by=null,completed_name=null,finisher_name=null,version=version+1
    where id=item_id returning * into h;
  end if;
 else raise exception '不支援的交接操作'; end if;
 insert into public.handover_revisions(handover_id,action,actor_id,actor_name,before_data,after_data,reason) values(item_id,action,actor,actor_name,before_row,to_jsonb(h),reason_text);
 insert into public.audit_logs(actor_id,action,handover_id) values(actor,action,item_id);
 return to_jsonb(h);
end $$;
revoke all on function public.handover_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.handover_command(uuid,text,jsonb) to service_role;
alter publication supabase_realtime add table public.internal_notes,public.handover_revisions;

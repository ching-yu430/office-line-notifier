-- 手動填寫的人名與登入帳號快照分開保存；舊紀錄沿用當時的顯示姓名。
alter table public.handovers add column handover_name text;
alter table public.handovers add column finisher_name text;
update public.handovers set handover_name=coalesce(nullif(left(trim(creator_name),80),''),'未填寫'),
 finisher_name=case when completed_at is not null then coalesce(nullif(left(trim(completed_name),80),''),'未填寫') end;
alter table public.handovers alter column handover_name set not null;
alter table public.handovers add constraint handover_name_valid check(length(trim(handover_name)) between 1 and 80);
alter table public.handovers add constraint handover_finisher_valid check(
 (completed_at is null and finisher_name is null)
 or (completed_at is not null and finisher_name is not null and length(trim(finisher_name)) between 1 and 80)
);
create or replace function public.handover_command(actor uuid, action text, payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor_name text; h public.handovers%rowtype; body text; item_id uuid; entered_name text;
begin
 select display_name into actor_name from public.staff
 where id=actor and active and role in ('admin','staff') for share;
 if not found then raise exception '未授權' using errcode='42501'; end if;
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
  entered_name:=trim(payload->>'finisher_name');
  if entered_name is null or length(entered_name) not between 1 and 80 then raise exception '請填寫 1 至 80 字的完成人姓名'; end if;
  update public.handovers set completed_at=now(),completed_by=actor,completed_name=actor_name,finisher_name=entered_name
   where id=item_id returning * into h;
 else raise exception '不支援的交接操作'; end if;
 insert into public.audit_logs(actor_id,action,handover_id) values(actor,action,item_id);
 return to_jsonb(h);
end $$;
revoke all on function public.handover_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.handover_command(uuid,text,jsonb) to service_role;

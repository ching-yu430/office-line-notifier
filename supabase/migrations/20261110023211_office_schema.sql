create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.staff (id uuid primary key references auth.users(id), display_name text not null, role text not null check(role in ('admin','staff')), active boolean not null default true);
create table public.teachers (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80), department text not null default '', notes text not null default '', active boolean not null default true, bound_at timestamptz, last_notified_at timestamptz, created_at timestamptz not null default now());
create table private.bindings (teacher_id uuid primary key references public.teachers, line_user_id text unique not null, binding_id uuid unique not null default gen_random_uuid(), blocked boolean not null default false);
create table private.binding_codes (teacher_id uuid primary key references public.teachers, digest text unique not null, expires_at timestamptz not null, created_by uuid references public.staff, created_at timestamptz not null default now());
create table private.rate_limits (bucket text primary key, window_at timestamptz not null, attempts integer not null);
create table private.message_sources (line_message_id text primary key, line_user_id text not null, teacher_id uuid not null references public.teachers);
alter table private.message_sources enable row level security;
create table private.unsent_messages (line_message_id text primary key, line_user_id text not null);
alter table private.unsent_messages enable row level security;
create table private.events (id text primary key, processed_at timestamptz not null default now(), result text);
create table public.notifications (id uuid primary key default gen_random_uuid(), request_id uuid not null, teacher_id uuid not null references public.teachers, kind text not null check(kind in ('mail','parcel','contact','custom','reply')), content text not null check(length(content) between 1 and 5000), important boolean not null default false, sender_id uuid not null references public.staff, send_status text not null default 'queued' check(send_status in ('queued','sending','accepted','failed','uncertain')), error_code text, status text not null default '待回覆' check(status in ('待領取','待回覆','已完成')), created_at timestamptz not null default now(), completed_at timestamptz, completed_by uuid references public.staff, retry_key uuid not null default gen_random_uuid(), binding_id uuid not null, unique(request_id,teacher_id));
create table public.messages (id uuid primary key default gen_random_uuid(), teacher_id uuid not null references public.teachers, notification_id uuid references public.notifications, direction text not null check(direction in ('in','out')), content text not null, line_message_id text unique, withdrawn boolean not null default false, created_at timestamptz not null default now());
create table public.conversations (teacher_id uuid primary key references public.teachers, status text not null default '待回覆' check(status in ('待回覆','已完成')), last_message_at timestamptz not null default now(), completed_at timestamptz, completed_by uuid references public.staff);
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid references public.staff, action text not null, teacher_id uuid references public.teachers, created_at timestamptz not null default now());
create table public.templates (kind text primary key, label text not null, content text not null check(length(content) between 1 and 5000));
insert into public.templates values ('mail','實體信件','您的信件已送達辦公室，請撥空領取。'),('parcel','包裹通知','您的包裹已送達辦公室，請撥空領取。'),('contact','行政聯絡','辦公室有事項需要與您聯繫。'),('custom','自訂訊息','請輸入通知內容。');
create index notifications_teacher_date on public.notifications(teacher_id,created_at desc);
create index notifications_status on public.notifications(status,created_at desc);
create index messages_teacher_date on public.messages(teacher_id,created_at);
create index audit_teacher_date on public.audit_logs(teacher_id,created_at desc);
create function public.office_role() returns text language sql stable security definer set search_path='' as $$ select role from public.staff where id=auth.uid() and active $$;
revoke all on function public.office_role() from public,anon;
grant execute on function public.office_role() to authenticated;
-- This helper is a deliberately restricted membership lookup; mutations use service-only RPC.
alter table public.staff enable row level security;
alter table public.teachers enable row level security;
alter table public.notifications enable row level security;
alter table public.messages enable row level security;
alter table public.conversations enable row level security;
create policy conversations_read on public.conversations for select to authenticated using ((select public.office_role()) in ('admin','staff'));
alter table public.audit_logs enable row level security;
alter table public.templates enable row level security;
create policy staff_read on public.staff for select to authenticated using (id=(select auth.uid()) or (select public.office_role())='admin');
create policy teachers_read on public.teachers for select to authenticated using ((select public.office_role()) in ('admin','staff'));
create policy notifications_read on public.notifications for select to authenticated using ((select public.office_role()) in ('admin','staff'));
create policy messages_read on public.messages for select to authenticated using ((select public.office_role()) in ('admin','staff'));
create policy audit_read on public.audit_logs for select to authenticated using ((select public.office_role())='admin');
create policy templates_read on public.templates for select to authenticated using ((select public.office_role()) in ('admin','staff'));
revoke all on public.staff,public.teachers,public.notifications,public.messages,public.audit_logs,public.templates,public.conversations from anon,authenticated;
grant select on public.staff,public.teachers,public.notifications,public.messages,public.audit_logs,public.templates,public.conversations to authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
alter table private.bindings enable row level security;
alter table private.binding_codes enable row level security;
alter table private.events enable row level security;
alter table private.rate_limits enable row level security;

create function public.office_command(actor uuid, action text, payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r text; t uuid; n uuid; b private.bindings%rowtype; rec record; result jsonb; v_id uuid;
begin
 select role into r from public.staff where id=actor and active for share;
 if r is null then raise exception '未授權' using errcode='42501'; end if;
 if action in ('teacher_save','issue_code','unbind','staff_save','template_save') and r<>'admin' then raise exception '需要管理員權限' using errcode='42501'; end if;
 t := nullif(payload->>'teacher_id','')::uuid;
 if action='teacher_save' then
  if t is null then insert into public.teachers(name,department,notes) values(trim(payload->>'name'),coalesce(payload->>'department',''),coalesce(payload->>'notes','')) returning id into t;
  else
   perform 1 from public.teachers where id=t for update;
   if exists(select 1 from public.notifications where teacher_id=t and send_status in ('sending','uncertain')) then raise exception '有傳送中或結果未明的通知，請先核對'; end if;
   update public.teachers set name=trim(payload->>'name'),department=coalesce(payload->>'department',''),notes=coalesce(payload->>'notes',''),active=(payload->>'active')::boolean where id=t;
   if not found then raise exception '教師不存在'; end if;
   if not (payload->>'active')::boolean then delete from private.binding_codes where teacher_id=t; end if;
  end if;
 elsif action='issue_code' then
  perform pg_advisory_xact_lock(714002);
  perform 1 from public.teachers where id=t and active and bound_at is null for update;
  if not found then raise exception '教師已綁定、停用或不存在'; end if;
  insert into private.binding_codes(teacher_id,digest,expires_at,created_by) values(t,payload->>'digest',now()+interval '7 days',actor) on conflict(teacher_id) do update set digest=excluded.digest,expires_at=excluded.expires_at,created_by=actor,created_at=now();
 elsif action='unbind' then
  perform pg_advisory_xact_lock(714002);
  perform 1 from public.teachers where id=t for update;
  if exists(select 1 from public.notifications where teacher_id=t and send_status in ('sending','uncertain')) then raise exception '有傳送中或結果未明的通知，請先核對'; end if;
  delete from private.bindings where teacher_id=t;
  delete from private.binding_codes where teacher_id=t;
  update public.teachers set bound_at=null where id=t;
 elsif action='staff_save' then
  perform pg_advisory_xact_lock(714003);
  v_id := (payload->>'id')::uuid;
  if v_id=actor then raise exception '不能修改自己的權限'; end if;
  insert into public.staff(id,display_name,role,active) values(v_id,payload->>'display_name',payload->>'role',(payload->>'active')::boolean) on conflict(id) do update set display_name=excluded.display_name,role=excluded.role,active=excluded.active;
 elsif action='template_save' then
  update public.templates set content=payload->>'content' where kind=payload->>'kind';
 elsif action='send' then
  if length(trim(payload->>'content')) not between 1 and 5000 or payload->>'kind' not in ('mail','parcel','contact','custom','reply') then raise exception '訊息內容或類型錯誤'; end if;
  if jsonb_array_length(payload->'teacher_ids') not between 1 and 100 then raise exception '每批限 1 至 100 位教師'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if (select count(*) from public.notifications where sender_id=actor and created_at>now()-interval '1 minute')+jsonb_array_length(payload->'teacher_ids')>100 then raise exception '每分鐘最多 100 則，請稍後再試'; end if;
  for t in select distinct value::uuid from jsonb_array_elements_text(payload->'teacher_ids') order by value::uuid loop
   perform 1 from public.teachers where id=t and active for update;
   if not found then raise exception '教師不存在或已停用'; end if;
   select * into b from private.bindings where teacher_id=t and not blocked;
   if not found then raise exception '教師尚未綁定或已封鎖帳號'; end if;
   if exists(select 1 from public.notifications where request_id=(payload->>'request_id')::uuid and teacher_id=t and (content<>payload->>'content' or kind<>payload->>'kind' or sender_id<>actor)) then raise exception '重複請求內容不一致'; end if;
   insert into public.notifications(request_id,teacher_id,kind,content,important,sender_id,binding_id,status)
    values((payload->>'request_id')::uuid,t,payload->>'kind',payload->>'content',coalesce((payload->>'important')::boolean,false),actor,b.binding_id,case when payload->>'kind' in ('mail','parcel') then '待領取' else '待回覆' end) on conflict(request_id,teacher_id) do nothing;
  end loop;
  select jsonb_agg(id) into result from public.notifications where request_id=(payload->>'request_id')::uuid and sender_id=actor;
 elsif action='dispatch' then
  select jsonb_agg(id) into result from (select id from public.notifications where id=(payload->>'id')::uuid and send_status='queued' limit 1) q;
  result:=coalesce(result,'[]'::jsonb);
 elsif action='conversation_status' then
  update public.conversations set status=payload->>'status',completed_at=case when payload->>'status'='已完成' then now() end,completed_by=case when payload->>'status'='已完成' then actor end where teacher_id=t;
 elsif action='complete' then
  update public.notifications set status=payload->>'status',completed_at=case when payload->>'status'='已完成' then now() end,completed_by=case when payload->>'status'='已完成' then actor end where id=(payload->>'id')::uuid returning teacher_id into t;
  if not found then raise exception '通知不存在'; end if;
 else raise exception '不支援的操作'; end if;
 insert into public.audit_logs(actor_id,action,teacher_id) values(actor,action,t);
 return coalesce(result,jsonb_build_object('teacher_id',t));
end $$;
revoke all on function public.office_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.office_command(uuid,text,jsonb) to service_role;

create function private.rate_allow(k text, maximum integer) returns boolean language plpgsql set search_path='' as $$
declare c integer;
begin
 insert into private.rate_limits(bucket,window_at,attempts) values(k,date_trunc('hour',now()),1) on conflict(bucket) do update set attempts=case when private.rate_limits.window_at<date_trunc('hour',now()) then 1 else private.rate_limits.attempts+1 end,window_at=date_trunc('hour',now()) returning attempts into c;
 return c<=maximum;
end $$;
revoke all on function private.rate_allow(text,integer) from public;
grant execute on function private.rate_allow(text,integer) to service_role;

create function public.line_event(e jsonb, code_digest text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t uuid; c private.binding_codes%rowtype; typ text := e->>'type'; uid text := e#>>'{source,userId}'; answer text := ''; permitted boolean; mid text;
begin
 perform pg_advisory_xact_lock(714002);
 insert into private.events(id) values(e->>'webhookEventId') on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true); end if;
 if e#>>'{source,type}'<>'user' or uid is null then return jsonb_build_object('ignored',true); end if;
 select teacher_id into t from private.bindings where line_user_id=uid;
 if t is not null and typ<>'unsend' and e ? 'timestamp' then
  if to_timestamp((e->>'timestamp')::numeric/1000) < (select bound_at from public.teachers where id=t) then
   update private.events set result='ignored_before_binding' where id=e->>'webhookEventId';
   return jsonb_build_object('ignored',true);
  end if;
 end if;
 if typ='unsend' then
  mid:=e#>>'{unsend,messageId}';
  insert into private.unsent_messages(line_message_id,line_user_id) values(mid,uid) on conflict do nothing;
  update public.messages set withdrawn=true,content='（老師已收回訊息）' where line_message_id=mid and exists(select 1 from private.message_sources s where s.line_message_id=mid and s.line_user_id=uid);
 elsif typ='unfollow' then
  update private.bindings set blocked=true where line_user_id=uid;
 elsif typ='follow' then
  update private.bindings set blocked=false where line_user_id=uid;
  answer:='歡迎加入辦公室通知，請輸入行政人員透過可信管道提供的一次性綁定碼。';
 elsif typ='message' and t is not null then
  mid:=e#>>'{message,id}';
  insert into public.messages(teacher_id,direction,content,line_message_id,withdrawn) values(t,'in',case when exists(select 1 from private.unsent_messages where line_message_id=mid and line_user_id=uid) then '（老師已收回訊息）' when e#>>'{message,type}'='text' then left(e#>>'{message,text}',5000) else '（收到非文字訊息，目前請改用文字回覆）' end,mid,exists(select 1 from private.unsent_messages where line_message_id=mid and line_user_id=uid)) on conflict(line_message_id) do nothing;
  insert into private.message_sources(line_message_id,line_user_id,teacher_id) values(mid,uid,t) on conflict do nothing;
  insert into public.conversations(teacher_id) values(t) on conflict(teacher_id) do update set status='待回覆',last_message_at=now(),completed_at=null,completed_by=null;
 elsif typ='message' then
  permitted:=private.rate_allow('global',1000);
  permitted:=private.rate_allow('user:'||uid,10) and permitted;
  if not permitted then answer:='嘗試次數過多，請一小時後再試或聯繫辦公室。';
  else
   select * into c from private.binding_codes where digest=code_digest and expires_at>now() for update;
   if not found then answer:='綁定碼無效或已過期，請向辦公室確認。';
   else
    perform 1 from public.teachers where id=c.teacher_id and active and bound_at is null for update;
    if not found then answer:='無法完成綁定，請聯繫辦公室。';
    else
     insert into private.bindings(teacher_id,line_user_id) values(c.teacher_id,uid);
     update public.teachers set bound_at=now() where id=c.teacher_id;
     delete from private.binding_codes where teacher_id=c.teacher_id;
     insert into public.audit_logs(action,teacher_id) values('line_bound',c.teacher_id);
     answer:='身分綁定成功，日後辦公室通知將透過此帳號傳送';
    end if;
   end if;
  end if;
 end if;
 update private.events set result=case when answer='' then 'stored' else 'reply_pending' end where id=e->>'webhookEventId';
 return jsonb_build_object('reply',answer);
end $$;
revoke all on function public.line_event(jsonb,text) from public,anon,authenticated;
grant execute on function public.line_event(jsonb,text) to service_role;

create function public.claim_delivery(nid uuid) returns jsonb language plpgsql set search_path='' as $$
declare n public.notifications%rowtype; b private.bindings%rowtype;
begin
 select * into n from public.notifications where id=nid for update;
 if n.send_status<>'queued' then return null; end if;
 perform 1 from public.teachers where id=n.teacher_id and active for update;
 if not found then update public.notifications set send_status='failed',error_code='teacher_inactive' where id=nid; return null; end if;
 select * into b from private.bindings where teacher_id=n.teacher_id and binding_id=n.binding_id and not blocked;
 if not found then update public.notifications set send_status='failed',error_code='binding_changed' where id=nid; return null; end if;
 update public.notifications set send_status='sending' where id=nid;
 return jsonb_build_object('to',b.line_user_id,'content',n.content,'retry_key',n.retry_key);
end $$;
create function public.finish_delivery(nid uuid, outcome text, err text) returns void language plpgsql set search_path='' as $$
declare n public.notifications%rowtype;
begin
 select * into n from public.notifications where id=nid for update;
 if n.send_status<>'sending' then return; end if;
 update public.notifications set send_status=outcome,error_code=err where id=nid;
 if outcome='accepted' then
  insert into public.messages(teacher_id,notification_id,direction,content) values(n.teacher_id,nid,'out',n.content);
  update public.teachers set last_notified_at=now() where id=n.teacher_id;
 end if;
end $$;
revoke all on function public.claim_delivery(uuid),public.finish_delivery(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_delivery(uuid),public.finish_delivery(uuid,text,text) to service_role;
-- Publish only safe tables. Never publish bindings, codes, event payloads or LINE IDs.
alter publication supabase_realtime add table public.teachers,public.notifications,public.messages,public.conversations;

create function public.finish_event(event_id text, outcome text) returns void language sql set search_path='' as $$ update private.events set result=outcome where id=event_id $$;
revoke all on function public.finish_event(text,text) from public,anon,authenticated;
grant execute on function public.finish_event(text,text) to service_role;

-- 實體物品與 LINE 發送紀錄分開保存；舊通知逐筆保留，不猜測合併。
CREATE TABLE pickup_items (
 id TEXT PRIMARY KEY,
 teacher_id TEXT NOT NULL REFERENCES teachers(id),
 kind TEXT NOT NULL CHECK(kind IN ('mail','parcel','custom')),
 pickup_name TEXT CHECK((kind='custom' AND pickup_name IS NOT NULL AND length(trim(pickup_name)) BETWEEN 1 AND 80) OR (kind IN ('mail','parcel') AND pickup_name IS NULL)),
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 5000),
 status TEXT NOT NULL DEFAULT '待領取' CHECK(status IN ('待領取','已完成','已取消')),
 created_by TEXT NOT NULL REFERENCES admins(id),
 created_at TEXT NOT NULL,
 completed_at TEXT,
 completed_by TEXT REFERENCES admins(id),
 cancelled_at TEXT,
 cancelled_by TEXT REFERENCES admins(id),
 cancellation_reason TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 operation_token TEXT
);
CREATE INDEX pickup_pending_time ON pickup_items(status,created_at DESC);
CREATE INDEX pickup_teacher_time ON pickup_items(teacher_id,status,created_at DESC);
ALTER TABLE notifications ADD COLUMN pickup_item_id TEXT REFERENCES pickup_items(id);
CREATE INDEX notification_item_time ON notifications(pickup_item_id,created_at DESC);
INSERT INTO pickup_items(id,teacher_id,kind,pickup_name,content,status,created_by,created_at,completed_at,completed_by,version)
 SELECT id,teacher_id,kind,pickup_name,content,CASE WHEN status='已完成' THEN '已完成' ELSE '待領取' END,sender_id,created_at,completed_at,completed_by,version
 FROM notifications WHERE kind IN ('mail','parcel') OR pickup_name IS NOT NULL;
UPDATE notifications SET pickup_item_id=id WHERE id IN(SELECT id FROM pickup_items);
CREATE TABLE pickup_item_undo (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES admins(id),
 snapshot TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at TEXT,
 undo_token TEXT
);
CREATE INDEX pickup_undo_expiry ON pickup_item_undo(expires_at);
-- 保留舊版 send/complete/undo 呼叫的行為，並將新通知連結至獨立物品。
CREATE TRIGGER create_item_for_notice AFTER INSERT ON notifications
 WHEN NEW.pickup_item_id IS NULL AND (NEW.kind IN ('mail','parcel') OR NEW.pickup_name IS NOT NULL)
 BEGIN
  INSERT INTO pickup_items(id,teacher_id,kind,pickup_name,content,status,created_by,created_at,completed_at,completed_by)
   VALUES(NEW.id,NEW.teacher_id,NEW.kind,NEW.pickup_name,NEW.content,CASE WHEN NEW.status='已完成' THEN '已完成' ELSE '待領取' END,NEW.sender_id,NEW.created_at,NEW.completed_at,NEW.completed_by);
  UPDATE notifications SET pickup_item_id=NEW.id WHERE id=NEW.id;
 END;
CREATE TRIGGER sync_legacy_pickup AFTER UPDATE OF status ON notifications
 WHEN NEW.pickup_item_id IS NOT NULL AND NEW.send_status='accepted' AND NEW.status IN ('待領取','已完成')
 BEGIN
  UPDATE pickup_items SET status=NEW.status,completed_at=NEW.completed_at,completed_by=NEW.completed_by,version=version+1
   WHERE id=NEW.pickup_item_id AND status!=NEW.status AND status!='已取消';
 END;
CREATE TRIGGER pickup_change_insert AFTER INSERT ON pickup_items BEGIN UPDATE system_meta SET version=version+1,backup_version=backup_version+1 WHERE id=1; END;
CREATE TRIGGER pickup_change_update AFTER UPDATE ON pickup_items BEGIN UPDATE system_meta SET version=version+1,backup_version=backup_version+1 WHERE id=1; END;
CREATE TRIGGER pickup_change_delete AFTER DELETE ON pickup_items BEGIN UPDATE system_meta SET version=version+1,backup_version=backup_version+1 WHERE id=1; END;
ALTER TABLE handovers ADD COLUMN teacher_id TEXT REFERENCES teachers(id);
CREATE INDEX handover_teacher ON handovers(teacher_id,completed_at);

CREATE TRIGGER pickup_conversation_insert AFTER INSERT ON pickup_items BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=NEW.teacher_id; END;
CREATE TRIGGER pickup_conversation_update AFTER UPDATE ON pickup_items BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id IN(OLD.teacher_id,NEW.teacher_id); END;
CREATE TRIGGER pickup_conversation_delete AFTER DELETE ON pickup_items BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=OLD.teacher_id; END;
CREATE TRIGGER validate_item_notice BEFORE INSERT ON notifications WHEN NEW.pickup_item_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'invalid_pickup_item') WHERE NOT EXISTS(SELECT 1 FROM pickup_items WHERE id=NEW.pickup_item_id AND teacher_id=NEW.teacher_id AND status='待領取' AND kind=NEW.kind AND coalesce(pickup_name,'')=coalesce(NEW.pickup_name,''));
END;

-- 防止同一物品的兩個同時請求各自建立待發送通知。
CREATE TRIGGER prevent_parallel_item_notice BEFORE INSERT ON notifications WHEN NEW.pickup_item_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'pickup_notice_pending') WHERE EXISTS(SELECT 1 FROM notifications WHERE pickup_item_id=NEW.pickup_item_id AND send_status IN ('queued','sending','uncertain'));
END;
CREATE INDEX messages_teacher_withdrawn ON messages(teacher_id,withdrawn);

-- 操作執行權與請求 ID 分離，平行重送同一請求也只修改一次。
ALTER TABLE send_requests ADD COLUMN operation_token TEXT;

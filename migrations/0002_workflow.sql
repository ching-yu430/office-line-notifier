-- 保留既有教師、訊息及帳號；新增共同值班的查看、輸入提示及操作復原。
ALTER TABLE notifications ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notifications ADD COLUMN operation_token TEXT;
CREATE TABLE conversation_views (
 teacher_id TEXT NOT NULL REFERENCES teachers(id), admin_id TEXT NOT NULL REFERENCES admins(id),
 last_seen_seq INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 PRIMARY KEY(teacher_id,admin_id)
);
CREATE TABLE reply_presence (
 teacher_id TEXT NOT NULL REFERENCES teachers(id), admin_id TEXT NOT NULL REFERENCES admins(id),
 client_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(teacher_id,admin_id,client_id)
);
CREATE INDEX presence_expiry ON reply_presence(expires_at);
CREATE TABLE undo_actions (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES admins(id),
 target_type TEXT NOT NULL CHECK(target_type IN ('notification','handover')),
 target_id TEXT NOT NULL, before_data TEXT NOT NULL, after_version INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, used_at TEXT
);
CREATE INDEX undo_expiry ON undo_actions(expires_at);
CREATE TRIGGER revision_views_INSERT AFTER INSERT ON conversation_views BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_views_UPDATE AFTER UPDATE ON conversation_views BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_presence_INSERT AFTER INSERT ON reply_presence BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_presence_UPDATE AFTER UPDATE ON reply_presence BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_presence_DELETE AFTER DELETE ON reply_presence BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;

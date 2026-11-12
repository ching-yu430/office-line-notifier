-- 辦公室小幫手：D1 / SQLite。所有時間採 UTC ISO 8601，Session／限流採 Unix 秒。
PRAGMA foreign_keys = ON;
CREATE TABLE admins (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER protect_last_admin BEFORE UPDATE OF active,role ON admins
WHEN OLD.active=1 AND OLD.role='admin' AND (NEW.active=0 OR NEW.role!='admin')
 AND (SELECT count(*) FROM admins WHERE active=1 AND role='admin')=1
BEGIN SELECT RAISE(ABORT,'last_admin'); END;
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id),
 csrf_hash TEXT NOT NULL, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX sessions_admin ON sessions(admin_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX rate_expiry ON rate_limits(expires_at);
CREATE TABLE teachers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 department TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 line_user_id TEXT UNIQUE, bound_at TEXT, binding_version INTEGER NOT NULL DEFAULT 0,
 bound_event_id TEXT, binding_event_time TEXT, last_notified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((line_user_id IS NULL AND bound_at IS NULL) OR (line_user_id IS NOT NULL AND bound_at IS NOT NULL))
);
CREATE INDEX teachers_name ON teachers(name);
CREATE TABLE binding_codes (
 teacher_id TEXT PRIMARY KEY REFERENCES teachers(id), code_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, used_at TEXT, issued_at TEXT NOT NULL, issued_by TEXT NOT NULL REFERENCES admins(id)
);
CREATE INDEX codes_expiry ON binding_codes(expires_at);
CREATE TABLE templates (kind TEXT PRIMARY KEY CHECK(kind IN ('mail','parcel','contact','custom')), label TEXT NOT NULL, content TEXT NOT NULL CHECK(length(content)<=5000));
INSERT INTO templates VALUES ('mail','實體信件','您的信件已送達辦公室，請撥空領取。'),('parcel','包裹通知','您的包裹已送達辦公室，請撥空領取。'),('contact','行政聯絡','辦公室有事項需要與您聯繫。'),('custom','自訂訊息','');
CREATE TABLE notifications (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, teacher_id TEXT NOT NULL REFERENCES teachers(id),
 kind TEXT NOT NULL CHECK(kind IN ('mail','parcel','contact','custom','reply')), content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 5000),
 important INTEGER NOT NULL DEFAULT 0, sender_id TEXT NOT NULL REFERENCES admins(id),
 binding_version INTEGER NOT NULL, retry_key TEXT NOT NULL UNIQUE,
 send_status TEXT NOT NULL DEFAULT 'queued' CHECK(send_status IN ('queued','sending','accepted','failed','uncertain')),
 status TEXT NOT NULL CHECK(status IN ('待領取','待回覆','已完成')), error_code TEXT,
 created_at TEXT NOT NULL, sent_at TEXT, claimed_at TEXT, completed_at TEXT, completed_by TEXT REFERENCES admins(id),
 UNIQUE(request_id,teacher_id)
);
CREATE INDEX notices_teacher_time ON notifications(teacher_id,created_at DESC);
CREATE INDEX notices_status_time ON notifications(status,created_at DESC);
CREATE INDEX notices_send_time ON notifications(send_status,created_at);
CREATE TABLE webhook_events (
 id TEXT PRIMARY KEY, claim_token TEXT NOT NULL, line_user_id TEXT, kind TEXT NOT NULL,
 event_time TEXT NOT NULL, outcome TEXT NOT NULL, reply_status TEXT, created_at TEXT NOT NULL
);
CREATE TABLE unsend_tombstones (
 line_message_id TEXT NOT NULL, line_user_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(line_message_id,line_user_id)
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES teachers(id), direction TEXT NOT NULL CHECK(direction IN ('in','out')),
 content TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', created_at TEXT NOT NULL,
 line_event_id TEXT UNIQUE REFERENCES webhook_events(id), line_message_id TEXT UNIQUE,
 notification_id TEXT UNIQUE REFERENCES notifications(id), withdrawn INTEGER NOT NULL DEFAULT 0 CHECK(withdrawn IN (0,1)),
 line_source_hash TEXT, processing_status TEXT NOT NULL DEFAULT 'received'
);
CREATE INDEX messages_teacher_time ON messages(teacher_id,created_at DESC);
CREATE TABLE conversations (
 teacher_id TEXT PRIMARY KEY REFERENCES teachers(id), status TEXT NOT NULL CHECK(status IN ('待回覆','已完成')), updated_at TEXT NOT NULL
);
CREATE TABLE handovers (
 id TEXT PRIMARY KEY, content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
 created_by TEXT NOT NULL REFERENCES admins(id), creator_name TEXT NOT NULL, handover_name TEXT NOT NULL CHECK(length(handover_name) BETWEEN 1 AND 80),
 created_at TEXT NOT NULL, completed_at TEXT, completed_by TEXT REFERENCES admins(id), completed_name TEXT,
 finisher_name TEXT CHECK(finisher_name IS NULL OR length(finisher_name) BETWEEN 1 AND 80), version INTEGER NOT NULL DEFAULT 1,
 CHECK((completed_at IS NULL AND completed_by IS NULL AND finisher_name IS NULL) OR (completed_at IS NOT NULL AND completed_by IS NOT NULL AND finisher_name IS NOT NULL))
);
CREATE INDEX handovers_completion ON handovers(completed_at,created_at DESC);
CREATE TABLE handover_revisions (
 id TEXT PRIMARY KEY, handover_id TEXT NOT NULL REFERENCES handovers(id), action TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES admins(id), actor_name TEXT NOT NULL, before_data TEXT, after_data TEXT NOT NULL,
 reason TEXT CHECK(reason IS NULL OR length(reason)<=500), created_at TEXT NOT NULL,
 json_version INTEGER NOT NULL, UNIQUE(handover_id, json_version)
);
CREATE INDEX revisions_time ON handover_revisions(handover_id,created_at DESC);
CREATE TABLE internal_notes (
 id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES teachers(id), content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
 author_id TEXT NOT NULL REFERENCES admins(id), author_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX notes_teacher_time ON internal_notes(teacher_id,created_at DESC);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES admins(id), action TEXT NOT NULL, result TEXT NOT NULL DEFAULT 'success',
 teacher_id TEXT REFERENCES teachers(id), handover_id TEXT REFERENCES handovers(id), internal_note_id TEXT REFERENCES internal_notes(id),
 created_at TEXT NOT NULL
);
CREATE INDEX audit_time ON audit_logs(created_at DESC);
CREATE TABLE system_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1);
INSERT INTO system_meta VALUES(1,1);
-- 讓輪詢只在資料改變時下載完整快照。
CREATE TRIGGER revision_admins_INSERT AFTER INSERT ON admins BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_admins_UPDATE AFTER UPDATE ON admins BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_admins_DELETE AFTER DELETE ON admins BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_teachers_INSERT AFTER INSERT ON teachers BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_teachers_UPDATE AFTER UPDATE ON teachers BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_teachers_DELETE AFTER DELETE ON teachers BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_templates_INSERT AFTER INSERT ON templates BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_templates_UPDATE AFTER UPDATE ON templates BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_templates_DELETE AFTER DELETE ON templates BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_notifications_INSERT AFTER INSERT ON notifications BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_notifications_UPDATE AFTER UPDATE ON notifications BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_notifications_DELETE AFTER DELETE ON notifications BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_messages_INSERT AFTER INSERT ON messages BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_messages_UPDATE AFTER UPDATE ON messages BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_messages_DELETE AFTER DELETE ON messages BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_conversations_INSERT AFTER INSERT ON conversations BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_conversations_UPDATE AFTER UPDATE ON conversations BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_conversations_DELETE AFTER DELETE ON conversations BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_handovers_INSERT AFTER INSERT ON handovers BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_handovers_UPDATE AFTER UPDATE ON handovers BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_handovers_DELETE AFTER DELETE ON handovers BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_handover_revisions_INSERT AFTER INSERT ON handover_revisions BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_handover_revisions_UPDATE AFTER UPDATE ON handover_revisions BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_handover_revisions_DELETE AFTER DELETE ON handover_revisions BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_internal_notes_INSERT AFTER INSERT ON internal_notes BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_internal_notes_UPDATE AFTER UPDATE ON internal_notes BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_internal_notes_DELETE AFTER DELETE ON internal_notes BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_audit_logs_INSERT AFTER INSERT ON audit_logs BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_audit_logs_UPDATE AFTER UPDATE ON audit_logs BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
CREATE TRIGGER revision_audit_logs_DELETE AFTER DELETE ON audit_logs BEGIN UPDATE system_meta SET version=version+1 WHERE id=1; END;
ALTER TABLE handovers ADD COLUMN operation_token TEXT;
CREATE TABLE send_requests(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES admins(id),fingerprint TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TRIGGER validate_notification BEFORE INSERT ON notifications
WHEN NOT EXISTS(SELECT 1 FROM teachers WHERE id=NEW.teacher_id AND active=1 AND line_user_id IS NOT NULL AND binding_version=NEW.binding_version)
BEGIN SELECT RAISE(ABORT,'invalid_binding'); END;
CREATE TRIGGER notification_audit AFTER INSERT ON notifications
BEGIN INSERT INTO audit_logs(id,actor_id,action,teacher_id,created_at) VALUES(NEW.id,NEW.sender_id,'send',NEW.teacher_id,NEW.created_at); END;

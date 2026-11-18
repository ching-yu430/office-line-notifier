-- 保留原有通知類型；自填待領物品是附有名稱的 custom 通知，既有資料不改寫。
ALTER TABLE notifications ADD COLUMN pickup_name TEXT
 CHECK(pickup_name IS NULL OR (kind='custom' AND length(trim(pickup_name)) BETWEEN 1 AND 80));
CREATE INDEX notices_pending_pickup ON notifications(teacher_id,status,created_at DESC)
 WHERE kind IN ('mail','parcel') OR pickup_name IS NOT NULL;
-- 每位教師的對話版本，用於新訊息、撤回與舊領件更新；其他對話變更不重讀本對話。
ALTER TABLE teachers ADD COLUMN conversation_version INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER conversation_notice_insert AFTER INSERT ON notifications BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=NEW.teacher_id; END;
CREATE TRIGGER conversation_notice_update AFTER UPDATE ON notifications BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=NEW.teacher_id; END;
CREATE TRIGGER conversation_notice_delete AFTER DELETE ON notifications BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=OLD.teacher_id; END;
CREATE TRIGGER conversation_message_insert AFTER INSERT ON messages BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=NEW.teacher_id; END;
CREATE TRIGGER conversation_message_update AFTER UPDATE ON messages BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=NEW.teacher_id; END;
CREATE TRIGGER conversation_message_delete AFTER DELETE ON messages BEGIN UPDATE teachers SET conversation_version=conversation_version+1 WHERE id=OLD.teacher_id; END;

-- 清理僅由管理員預覽及確認後執行；不自動刪除歷史。
ALTER TABLE send_requests ADD COLUMN archived_at TEXT;
ALTER TABLE audit_logs ADD COLUMN details TEXT;
CREATE TABLE record_cleanup_jobs (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES admins(id),
 cutoff TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('preview','running','completed')),
 plan_json TEXT, result_json TEXT NOT NULL, operation_token TEXT, completed_at TEXT
);
CREATE INDEX cleanup_expiry ON record_cleanup_jobs(state,expires_at);
CREATE INDEX messages_cleanup_time ON messages(created_at);
-- SQLite 的一般索引自帶 rowid 尾碼，讓每位教師的最後訊息能直接定位。
CREATE INDEX messages_teacher_sequence ON messages(teacher_id);
CREATE INDEX notices_cleanup_time ON notifications(completed_at) WHERE status='已完成';

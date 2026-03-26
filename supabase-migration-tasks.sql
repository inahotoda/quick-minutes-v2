-- Next Action Bridge: タスク抽出・配信テーブル
-- 議事録からAIが構造化抽出したタスクと、その配信ログを管理

-- tasks テーブル
CREATE TABLE IF NOT EXISTS tasks (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_domain    TEXT,
  meeting_id       UUID,
  extraction_batch UUID NOT NULL,
  -- タスク内容
  assignee         TEXT,
  assignee_confidence FLOAT DEFAULT 0.0,
  action_summary   TEXT NOT NULL,
  action_context   TEXT,
  source_text      TEXT,
  -- 期限
  deadline_raw     TEXT,
  deadline_date    DATE,
  deadline_confidence FLOAT DEFAULT 0.0,
  -- 分類
  priority         TEXT DEFAULT 'medium'
                   CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  recommended_channels TEXT[] DEFAULT '{}',
  -- エンリッチメント（Pro/社内版）
  message_draft    TEXT,
  enriched_data    JSONB,
  -- ステータス
  status           TEXT DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'edited', 'skipped', 'delivered', 'failed')),
  user_edits       JSONB,
  -- タイムスタンプ
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_batch ON tasks (tenant_domain, extraction_batch);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_meeting ON tasks (meeting_id);

-- task_deliveries テーブル
CREATE TABLE IF NOT EXISTS task_deliveries (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('google_calendar', 'google_chat')),
  payload         JSONB,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'failed')),
  external_id     TEXT,
  error_message   TEXT,
  delivered_by    TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_deliveries_task ON task_deliveries (task_id);
CREATE INDEX IF NOT EXISTS idx_task_deliveries_status ON task_deliveries (status);

-- RLS（既存テーブルと同じパターン：サーバーサイドで認可制御）
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON task_deliveries FOR ALL USING (true) WITH CHECK (true);

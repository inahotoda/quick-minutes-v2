-- Usage Logs: コスト計測・利用状況トラッキング
-- 月間会議数・総時間・APIコストを計測する

CREATE TABLE usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_domain TEXT NOT NULL,
  user_email TEXT NOT NULL,
  event_type TEXT NOT NULL,            -- 'generate', 'regenerate', 'stt', 'task_extract', 'terminology', 'profile'
  duration_ms INTEGER,                 -- 処理時間（ミリ秒）
  audio_duration_sec INTEGER,          -- 音声の長さ（秒）
  model TEXT,                          -- 'gemini-flash-latest' etc
  metadata JSONB DEFAULT '{}',         -- 追加情報（ファイル数、タスク数など）
  created_at TIMESTAMPTZ DEFAULT now()
);

-- テナント別の利用状況集計用
CREATE INDEX idx_usage_logs_tenant ON usage_logs(tenant_domain);
-- 期間指定クエリ用
CREATE INDEX idx_usage_logs_created ON usage_logs(created_at);
-- イベント種別フィルタ用
CREATE INDEX idx_usage_logs_event ON usage_logs(event_type);
-- テナント×期間の複合クエリ用
CREATE INDEX idx_usage_logs_tenant_created ON usage_logs(tenant_domain, created_at);

-- RLSポリシー（service_role経由のみ書き込み可）
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert usage logs"
  ON usage_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can read usage logs"
  ON usage_logs FOR SELECT
  TO service_role
  USING (true);

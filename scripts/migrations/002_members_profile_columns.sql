-- ============================================================
-- 002: knowledge.members にプロファイルカラムを追加
--
-- knowledgeスキーマ直接参照移行(a8ed8cb)で欠落した
-- メンバープロファイルデータ(company, department, role, type)を
-- knowledge.members テーブルに直接保持するためのカラム追加
-- ============================================================

ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS member_type TEXT;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS voice_sample_base64 TEXT;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS voice_sample_duration NUMERIC;
ALTER TABLE knowledge.members ADD COLUMN IF NOT EXISTS voice_sample_recorded_at TEXT;

-- external_id のインデックス（フロント互換IDでの検索用）
CREATE INDEX IF NOT EXISTS idx_members_external_id
  ON knowledge.members(external_id) WHERE external_id IS NOT NULL;

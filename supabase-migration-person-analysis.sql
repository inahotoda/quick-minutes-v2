-- ═══════════════════════════════════════════════════
-- Quick Minutes - 人物プロファイル分析システム
-- meeting_person_analysis + person_profiles テーブル
-- ═══════════════════════════════════════════════════

-- 1. 議事録×人物 分析テーブル
CREATE TABLE meeting_person_analysis (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id      UUID,                        -- 議事録ID（現状NULL、将来的にFK設定）
  person_name     TEXT NOT NULL,              -- 発言者名

  -- MVV適合度シグナル
  mvv_signals     JSONB NOT NULL DEFAULT '{}',

  -- ポジティブ/ネガティブ分析（テーマ別）
  topic_sentiments JSONB NOT NULL DEFAULT '[]',

  -- 発言量
  utterance_count INT NOT NULL DEFAULT 0,
  utterance_chars INT NOT NULL DEFAULT 0,
  meeting_total_utterances INT DEFAULT 0,

  -- メタデータ
  meeting_date    DATE,
  analyzed_at     TIMESTAMPTZ DEFAULT now(),

  UNIQUE (meeting_id, person_name)
);

CREATE INDEX idx_mpa_person ON meeting_person_analysis(person_name, meeting_date);
CREATE INDEX idx_mpa_meeting ON meeting_person_analysis(meeting_id);
CREATE INDEX idx_mpa_date ON meeting_person_analysis(meeting_date DESC);

-- 2. 人物プロファイルテーブル
CREATE TABLE person_profiles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  person_name     TEXT NOT NULL,

  -- 対象期間
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  meetings_analyzed INT NOT NULL DEFAULT 0,

  -- MVV適合度スコア（各 0〜100）
  mvv_v1_score    INT,
  mvv_v2_score    INT,
  mvv_v3_score    INT,
  mvv_overall     INT,

  -- MVV詳細
  mvv_detail      JSONB NOT NULL DEFAULT '{}',

  -- ポジティブ/ネガティブ傾向
  affinity_profile JSONB NOT NULL DEFAULT '{}',

  -- 発言量サマリー
  avg_utterance_count   FLOAT,
  avg_utterance_ratio   FLOAT,
  utterance_trend       TEXT,
  low_participation_flag BOOLEAN DEFAULT FALSE,

  -- プロファイルテキスト
  summary_text    TEXT,
  assignment_recommendation TEXT,

  generated_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE (person_name, period_start, period_end)
);

CREATE INDEX idx_profiles_person ON person_profiles(person_name, generated_at DESC);

-- 3. RLSポリシー（Phase 1: 全許可）
ALTER TABLE meeting_person_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on meeting_person_analysis" ON meeting_person_analysis
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all on person_profiles" ON person_profiles
    FOR ALL USING (true) WITH CHECK (true);

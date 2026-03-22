-- ═══════════════════════════════════════════════════
-- Quick Minutes - 専門用語自己改善パイプライン
-- terminology_unresolved テーブル
-- ═══════════════════════════════════════════════════

CREATE TABLE terminology_unresolved (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id            UUID,                     -- 組織ID ※社内版ではNULL可。モニター版で必須化+FK設定

  -- 用語情報
  term              TEXT NOT NULL,            -- 検出された用語
  supplementary     TEXT,                     -- AI推定の補足（読み or 正式名称 or 意味）
  context           TEXT NOT NULL,            -- 出現した前後の文脈（1〜2文）
  category_guess    TEXT NOT NULL             -- AI推定カテゴリ
                    CHECK (category_guess IN ('略語・社内用語', '専門用語', '社名・ブランド名')),

  -- 出現トラッキング
  occurrence_count  INT DEFAULT 1,
  first_seen_at     TIMESTAMPTZ DEFAULT now(),
  last_seen_at      TIMESTAMPTZ DEFAULT now(),
  first_meeting_id  UUID,                     -- 初出の議事録ID
  last_meeting_id   UUID,                     -- 最終出現の議事録ID

  -- ステータス
  status            TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ignored', 'resolved')),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  UNIQUE (org_id, term)
);

CREATE INDEX idx_unresolved_org_status ON terminology_unresolved(org_id, status);
CREATE INDEX idx_unresolved_org_count ON terminology_unresolved(org_id, occurrence_count DESC);

-- RLSポリシー（Phase 1: 全許可）
ALTER TABLE terminology_unresolved ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on terminology_unresolved" ON terminology_unresolved
    FOR ALL USING (true) WITH CHECK (true);

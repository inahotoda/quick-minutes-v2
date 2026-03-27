-- ============================================================
-- INAHO Knowledge Portal — knowledge スキーマ
-- 001_knowledge_schema.sql
--
-- メンバー管理（社内）と取引先管理（社外）を完全分離した設計
-- ============================================================

-- スキーマ作成
CREATE SCHEMA IF NOT EXISTS knowledge;

-- ============================================================
-- 社内（メンバー管理）
-- ============================================================

-- 部署階層（自社の組織図）
CREATE TABLE knowledge.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES knowledge.departments(id) ON DELETE SET NULL,
  level INT NOT NULL DEFAULT 0,
  head_member_id UUID, -- 後でALTER ADDする（membersとの循環参照回避）
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 社内メンバー
CREATE TABLE knowledge.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  name TEXT NOT NULL,
  email TEXT,
  voice_sample_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at DATE,
  left_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- departments.head_member_id の外部キー追加（循環参照回避後）
ALTER TABLE knowledge.departments
  ADD CONSTRAINT fk_departments_head_member
  FOREIGN KEY (head_member_id) REFERENCES knowledge.members(id) ON DELETE SET NULL;

-- メンバーの所属・役職（異動履歴・兼務対応）
CREATE TABLE knowledge.member_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES knowledge.members(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES knowledge.departments(id) ON DELETE CASCADE,
  title TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  started_at DATE,
  ended_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- メンバーの呼び名・ニックネーム
CREATE TABLE knowledge.member_name_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES knowledge.members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 社外（取引先管理）
-- ============================================================

-- 取引先の会社
CREATE TABLE knowledge.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  name TEXT NOT NULL,
  name_kana TEXT,
  short_name TEXT,
  type TEXT NOT NULL DEFAULT 'client'
    CHECK (type IN ('client', 'supplier', 'outsource', 'other')),
  industry TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  notes TEXT,
  external_id TEXT, -- オーダープラス連携用
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 取引先の組織編成（部門・機能の構造）
CREATE TABLE knowledge.company_divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  company_id UUID NOT NULL REFERENCES knowledge.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES knowledge.company_divisions(id) ON DELETE SET NULL,
  is_outsourced BOOLEAN NOT NULL DEFAULT false,
  outsource_note TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 取引先の人（キーパーソン）
CREATE TABLE knowledge.company_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  company_id UUID NOT NULL REFERENCES knowledge.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_kana TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  voice_sample_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 取引先の人の役割（兼務対応）
CREATE TABLE knowledge.company_contact_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES knowledge.company_contacts(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES knowledge.company_divisions(id) ON DELETE CASCADE,
  title TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 取引先のブランド
CREATE TABLE knowledge.company_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  company_id UUID NOT NULL REFERENCES knowledge.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_kana TEXT,
  category TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 共有テーブル
-- ============================================================

-- 用語辞書
CREATE TABLE knowledge.terminology (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  term TEXT NOT NULL,
  reading TEXT,
  definition TEXT,
  category TEXT DEFAULT 'general'
    CHECK (category IN ('abbreviation', 'technical', 'brand', 'internal', 'general')),
  source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto_extracted', 'imported')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, term)
);

-- 人物プロファイル v2（社内/社外両方対応）
CREATE TABLE knowledge.person_profiles_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  source TEXT NOT NULL CHECK (source IN ('member', 'contact')),
  source_id UUID NOT NULL, -- members.id or company_contacts.id
  person_name TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  meetings_analyzed INT DEFAULT 0,
  mvv_v1_score NUMERIC(3,2),
  mvv_v2_score NUMERIC(3,2),
  mvv_v3_score NUMERIC(3,2),
  summary_text TEXT,
  affinity_profile JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会議プリセット
CREATE TABLE knowledge.meeting_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  name TEXT NOT NULL,
  description TEXT,
  additional_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- プリセット×参加者（社内/社外両方対応）
CREATE TABLE knowledge.preset_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id UUID NOT NULL REFERENCES knowledge.meeting_presets(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('member', 'contact')),
  source_id UUID NOT NULL, -- members.id or company_contacts.id
  role TEXT DEFAULT 'participant'
    CHECK (role IN ('facilitator', 'participant', 'observer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 会議設計
-- ============================================================

CREATE TABLE knowledge.meeting_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  preset_id UUID REFERENCES knowledge.meeting_presets(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  purpose TEXT,
  expected_outcome TEXT,
  scheduled_at TIMESTAMPTZ,
  duration_minutes INT DEFAULT 60,
  self_meeting_enabled BOOLEAN DEFAULT false,
  self_meeting_deadline TIMESTAMPTZ,
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.meeting_design_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_design_id UUID NOT NULL REFERENCES knowledge.meeting_designs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'discussion'
    CHECK (type IN ('discussion', 'presentation', 'decision', 'info_sharing', 'brainstorm', 'other')),
  duration_minutes INT,
  presenter_source TEXT CHECK (presenter_source IN ('member', 'contact')),
  presenter_id UUID,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.meeting_design_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_design_id UUID NOT NULL REFERENCES knowledge.meeting_designs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('member', 'contact')),
  source_id UUID NOT NULL,
  participation TEXT DEFAULT 'required'
    CHECK (participation IN ('required', 'optional', 'self_meeting_only')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- セルフ会議
-- ============================================================

CREATE TABLE knowledge.self_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_design_id UUID NOT NULL REFERENCES knowledge.meeting_designs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('member', 'contact')),
  source_id UUID NOT NULL,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  summary TEXT,
  key_points JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.self_meeting_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  self_meeting_id UUID NOT NULL REFERENCES knowledge.self_meetings(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AIチャットボット
-- ============================================================

CREATE TABLE knowledge.chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
  user_email TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES knowledge.chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ナレッジ埋め込み（将来用 — pgvector必要）
-- ============================================================

-- CREATE TABLE knowledge.knowledge_embeddings (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   tenant_id TEXT NOT NULL REFERENCES public.allowed_tenants(tenant_id),
--   source_type TEXT NOT NULL,
--   source_id UUID NOT NULL,
--   chunk_text TEXT NOT NULL,
--   embedding vector(768),
--   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
-- );

-- ============================================================
-- インデックス
-- ============================================================

-- 社内
CREATE INDEX idx_departments_tenant ON knowledge.departments(tenant_id);
CREATE INDEX idx_departments_parent ON knowledge.departments(parent_id);
CREATE INDEX idx_members_tenant ON knowledge.members(tenant_id);
CREATE INDEX idx_members_tenant_active ON knowledge.members(tenant_id) WHERE is_active = true;
CREATE INDEX idx_member_positions_member ON knowledge.member_positions(member_id);
CREATE INDEX idx_member_positions_department ON knowledge.member_positions(department_id);
CREATE INDEX idx_member_positions_current ON knowledge.member_positions(member_id) WHERE ended_at IS NULL;
CREATE INDEX idx_member_name_variants_member ON knowledge.member_name_variants(member_id);

-- 社外
CREATE INDEX idx_companies_tenant ON knowledge.companies(tenant_id);
CREATE INDEX idx_companies_tenant_type ON knowledge.companies(tenant_id, type);
CREATE INDEX idx_companies_external_id ON knowledge.companies(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_company_divisions_company ON knowledge.company_divisions(company_id);
CREATE INDEX idx_company_divisions_parent ON knowledge.company_divisions(parent_id);
CREATE INDEX idx_company_contacts_company ON knowledge.company_contacts(company_id);
CREATE INDEX idx_company_contacts_tenant ON knowledge.company_contacts(tenant_id);
CREATE INDEX idx_company_contacts_tenant_active ON knowledge.company_contacts(tenant_id) WHERE is_active = true;
CREATE INDEX idx_company_contact_roles_contact ON knowledge.company_contact_roles(contact_id);
CREATE INDEX idx_company_contact_roles_division ON knowledge.company_contact_roles(division_id);
CREATE INDEX idx_company_brands_company ON knowledge.company_brands(company_id);

-- 共有
CREATE INDEX idx_terminology_tenant ON knowledge.terminology(tenant_id);
CREATE INDEX idx_terminology_tenant_term ON knowledge.terminology(tenant_id, term);
CREATE INDEX idx_person_profiles_v2_tenant ON knowledge.person_profiles_v2(tenant_id);
CREATE INDEX idx_person_profiles_v2_source ON knowledge.person_profiles_v2(source, source_id);
CREATE INDEX idx_meeting_presets_tenant ON knowledge.meeting_presets(tenant_id);
CREATE INDEX idx_preset_members_preset ON knowledge.preset_members(preset_id);
CREATE INDEX idx_meeting_designs_tenant ON knowledge.meeting_designs(tenant_id);
CREATE INDEX idx_meeting_design_members_design ON knowledge.meeting_design_members(meeting_design_id);
CREATE INDEX idx_self_meetings_design ON knowledge.self_meetings(meeting_design_id);
CREATE INDEX idx_self_meeting_messages_meeting ON knowledge.self_meeting_messages(self_meeting_id);
CREATE INDEX idx_chat_sessions_tenant ON knowledge.chat_sessions(tenant_id);
CREATE INDEX idx_chat_messages_session ON knowledge.chat_messages(session_id);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
-- 現状はサーバーサイド認証のため FOR ALL USING (true) で設定
-- 将来的にJWT claimsベースのRLSに移行予定

ALTER TABLE knowledge.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.member_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.member_name_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.company_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.company_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.company_contact_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.company_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.terminology ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.person_profiles_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.meeting_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.preset_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.meeting_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.meeting_design_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.meeting_design_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.self_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.self_meeting_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge.chat_messages ENABLE ROW LEVEL SECURITY;

-- サーバーサイド認証用ポリシー（anon/service_role両方許可）
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'knowledge'
  LOOP
    EXECUTE format(
      'CREATE POLICY allow_all ON knowledge.%I FOR ALL USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END
$$;

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================

CREATE OR REPLACE FUNCTION knowledge.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'knowledge'
    AND table_name IN (
      'departments', 'members', 'member_positions',
      'companies', 'company_divisions', 'company_contacts', 'company_brands',
      'terminology', 'person_profiles_v2',
      'meeting_presets', 'meeting_designs',
      'self_meetings', 'chat_sessions'
    )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trigger_updated_at BEFORE UPDATE ON knowledge.%I
       FOR EACH ROW EXECUTE FUNCTION knowledge.update_updated_at()',
      tbl
    );
  END LOOP;
END
$$;

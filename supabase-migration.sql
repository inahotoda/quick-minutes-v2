-- ═══════════════════════════════════════════════════
-- Quick Minutes Trial - Multi-tenant tables
-- ═══════════════════════════════════════════════════

-- 1. テナント（モニター企業）管理
CREATE TABLE IF NOT EXISTS allowed_tenants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id TEXT UNIQUE NOT NULL,          -- e.g. "abc-corp"
    domain TEXT UNIQUE NOT NULL,             -- e.g. "abc-corp.co.jp"
    company_name TEXT NOT NULL,              -- e.g. "ABC商事"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,         -- 30日後
    is_active BOOLEAN DEFAULT TRUE
);

-- 2. テナント別設定データ
CREATE TABLE IF NOT EXISTS tenant_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES allowed_tenants(tenant_id) ON DELETE CASCADE,
    config_type TEXT NOT NULL,               -- "prompts" | "members" | "presets"
    data JSONB NOT NULL DEFAULT '{}',
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, config_type)
);

-- 3. INDEXes
CREATE INDEX IF NOT EXISTS idx_tenant_configs_tenant_id ON tenant_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_allowed_tenants_domain ON allowed_tenants(domain);

-- 4. Row Level Security (RLS)
ALTER TABLE allowed_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_configs ENABLE ROW LEVEL SECURITY;

-- anon key でも読み書きを許可するポリシー
-- （アプリ側でテナント判定・認証済みの状態で呼び出す前提）
CREATE POLICY "Allow read allowed_tenants" ON allowed_tenants
    FOR SELECT USING (true);

CREATE POLICY "Allow read tenant_configs" ON tenant_configs
    FOR SELECT USING (true);

CREATE POLICY "Allow insert tenant_configs" ON tenant_configs
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update tenant_configs" ON tenant_configs
    FOR UPDATE USING (true);

-- 5. サンプルデータ（INAHO自社テスト用）
-- INSERT INTO allowed_tenants (tenant_id, domain, company_name, expires_at)
-- VALUES ('inaho', 'inaho-inc.com', '株式会社INAHO', NOW() + INTERVAL '365 days');

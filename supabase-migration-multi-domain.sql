-- ═══════════════════════════════════════════════════
-- Quick Minutes Trial - Multi-domain migration
-- 1企業に複数のドメイン/メールを紐付けるためのスキーマ変更
-- ═══════════════════════════════════════════════════

-- 1. 新テーブル: tenant_domains
CREATE TABLE IF NOT EXISTS tenant_domains (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES allowed_tenants(tenant_id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    email TEXT,
    match_type TEXT NOT NULL,  -- 'domain' | 'email'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 既存データ移行
INSERT INTO tenant_domains (tenant_id, domain, email, match_type)
SELECT tenant_id, domain, email,
       COALESCE(match_type, 'domain')
FROM allowed_tenants
ON CONFLICT DO NOTHING;

-- 3. allowed_tenants から不要カラム削除
ALTER TABLE allowed_tenants DROP COLUMN IF EXISTS domain;
ALTER TABLE allowed_tenants DROP COLUMN IF EXISTS email;
ALTER TABLE allowed_tenants DROP COLUMN IF EXISTS match_type;

-- 4. INDEX
CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant_id ON tenant_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_domain ON tenant_domains(domain);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_email ON tenant_domains(email);

-- 5. RLS
ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read tenant_domains" ON tenant_domains
    FOR SELECT USING (true);

CREATE POLICY "Allow insert tenant_domains" ON tenant_domains
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow delete tenant_domains" ON tenant_domains
    FOR DELETE USING (true);

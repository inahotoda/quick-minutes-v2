-- ═══════════════════════════════════════════════════
-- Quick Minutes - terminology_unresolved に reading_guess カラム追加
-- AI推定の読み仮名を個別に保存するため
-- ═══════════════════════════════════════════════════

-- 1. reading_guess カラム追加
ALTER TABLE terminology_unresolved
ADD COLUMN IF NOT EXISTS reading_guess TEXT;

-- 2. description_guess カラム追加（supplementary を reading/description に分離）
ALTER TABLE terminology_unresolved
ADD COLUMN IF NOT EXISTS description_guess TEXT;

-- 3. 既存データのsupplementaryをdescription_guessにコピー
UPDATE terminology_unresolved
SET description_guess = supplementary
WHERE supplementary IS NOT NULL AND description_guess IS NULL;

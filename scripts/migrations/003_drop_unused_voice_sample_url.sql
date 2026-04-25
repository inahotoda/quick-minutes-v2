-- ============================================================================
-- 003: Drop unused voice_sample_url columns
-- ============================================================================
--
-- 背景:
--   001 マイグレーションで knowledge.members.voice_sample_url と
--   knowledge.company_contacts.voice_sample_url が定義されたが、
--   002 で voice_sample_base64 が追加されて以降、アプリケーションコードは
--   全て voice_sample_base64 だけを使っている（voice_sample_url を書き込む
--   箇所も読み出す箇所も存在しない）。
--
--   本マイグレーションは dead column となっている voice_sample_url を
--   安全にドロップする。
--
-- 実行前チェックリスト:
--   1. 本番 DB で以下のクエリを流し、voice_sample_url に値が入った行が
--      ないことを確認する。値が入っている場合は、その行を先に手動で
--      voice_sample_base64 に移行してから本マイグレーションを実行すること。
--
--        SELECT COUNT(*) FROM knowledge.members WHERE voice_sample_url IS NOT NULL;
--        SELECT COUNT(*) FROM knowledge.company_contacts WHERE voice_sample_url IS NOT NULL;
--
--   2. 念のため `pg_dump` でバックアップを取得しておく。
--
-- ロールバック:
--   ALTER TABLE knowledge.members ADD COLUMN voice_sample_url TEXT;
--   ALTER TABLE knowledge.company_contacts ADD COLUMN voice_sample_url TEXT;
--   （中身は復元されない。バックアップからの復元が必要）
-- ============================================================================

BEGIN;

-- 安全策: dead 確認のアサーション（値が入っていたら中断）
DO $$
DECLARE
    members_with_url INT;
    contacts_with_url INT;
BEGIN
    SELECT COUNT(*) INTO members_with_url
    FROM knowledge.members
    WHERE voice_sample_url IS NOT NULL;

    SELECT COUNT(*) INTO contacts_with_url
    FROM knowledge.company_contacts
    WHERE voice_sample_url IS NOT NULL;

    IF members_with_url > 0 THEN
        RAISE EXCEPTION 'knowledge.members に voice_sample_url が設定された行が % 件あります。先にデータ移行してください。', members_with_url;
    END IF;

    IF contacts_with_url > 0 THEN
        RAISE EXCEPTION 'knowledge.company_contacts に voice_sample_url が設定された行が % 件あります。先にデータ移行してください。', contacts_with_url;
    END IF;
END $$;

-- ドロップ
ALTER TABLE knowledge.members DROP COLUMN IF EXISTS voice_sample_url;
ALTER TABLE knowledge.company_contacts DROP COLUMN IF EXISTS voice_sample_url;

COMMIT;

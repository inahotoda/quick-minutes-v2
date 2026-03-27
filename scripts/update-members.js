/**
 * メンバーデータ更新スクリプト
 * 組織図をもとに既存メンバーの department / role / type / company を更新
 * 括弧付き名前を分解（括弧内 = 会社名）
 * 重複メンバーを統合（音声ありを優先）
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    "https://dmtkkwhwjzigbslcmzcu.supabase.co",
    "sb_publishable_HK9RRUZVwGLLpWZag3kN_w_AabeEj4k"
);

const TENANT_ID = "inaho";

// ==============================
// 組織図ベースの更新マッピング
// ==============================
const ORG_UPDATES = {
    // === 経営管理室 ===
    "member-1770007074063-e4aq1pf0q": {
        // 戸田 - 既にOK
    },
    "member-1770343131565-a9e1cx83o": {
        // 山崎 (voice有り = メイン)
        company: "INAHO", department: "経営管理室 / FM", role: "Bago取締役 / 工場責任者", type: "internal",
    },
    "member-1770272534442-r03kcol7y": {
        // 皿海
        company: "INAHO", department: "経営管理室 / CX", role: "実務 / 広報マネージャー", type: "internal",
    },

    // === CX事業部 ===
    "member-1770104723783-7slqqm9kp": {
        // 中道 - department/typeはOK、roleを修正
        role: "事業部長",
    },
    "member-1770272568606-010pdcu45": {
        // 吉田はるか
        company: "INAHO", department: "CX / Client Relations", role: null, type: "internal",
        nameVariants: ["吉田(は)", "吉田はるか"],
    },

    // === PS事業部 ===
    "member-1770339097360-2f9btc4l9": {
        // 金村
        company: "INAHO", department: "PS", role: "事業部長", type: "internal",
    },
    "member-1770601136993-w43mky98r": {
        // 森本
        company: "INAHO", department: "PS / 生産管理", role: null, type: "internal",
    },
    "member-1770601117468-5tpopc5c3": {
        // 西平
        company: "INAHO", department: "PS / 生産管理", role: null, type: "internal",
    },
    "member-1770178243216-vkmu01n0o": {
        // 長友
        company: "INAHO", department: "PS / 工場開拓", role: null, type: "internal",
    },
    "member-1770601153392-x1b208e6f": {
        // 佐々木
        company: "INAHO", department: "PS / 品質管理", role: "リーダー", type: "internal",
    },

    // === R&D事業部 ===
    "member-1770159712429-qxtjofh78": {
        // 鈴木 (voice有り = INAHO鈴木)
        company: "INAHO", department: "R&D", role: "事業部長", type: "internal",
    },

    // === FM事業部 ===
    "member-1770351608419-pf46603th": {
        // 古本 (voice有り = メイン)
        company: "INAHO", department: "FM", role: "事業部長 / 工場設備統括", type: "internal",
    },
    "member-1770338548763-ljlujnup3": {
        // 宇野 (voice有り = メイン)
        company: "INAHO", department: "FM", role: "品質管理統括", type: "internal",
    },

    // === 顧問・外部 ===
    "member-1771389752458-to7k9jfqx": {
        // 田中純一 = 田中(旬)
        company: "INAHO", department: "顧問", role: "顧問", type: "internal",
        nameVariants: ["田中(旬)", "田中純一", "じゅんさん"],
    },
    "member-1771389760778-lvs3tv5s6": {
        // 原田
        company: "INAHO", department: "顧問", role: "東京ディレクター", type: "internal",
    },
    "member-1771985014635-wuunz70pd": {
        // 田中辰巳 = 田中(辰)
        company: "INAHO", department: "顧問", role: "インドネシア統括", type: "internal",
        nameVariants: ["田中(辰)", "田中辰巳", "辰巳さん"],
    },

    // === 店舗スタッフ (INAHO社内) ===
    // 田辺 — SSF/INOBE
    "member-1772671899086-n53vh8wc9": {
        // 田辺 (voice有り = メイン)
        company: "INAHO", department: "CX / SSF・INOBE", role: null, type: "internal",
    },
    // 松本 — SSF/INOBE
    "member-1772671861628-gnzbile0v": {
        // 松本 (voice有り = メイン)
        company: "INAHO", department: "CX / SSF・INOBE", role: null, type: "internal",
    },
    // 吉田 — 吉田(愛) = SSF/INOBE
    "member-1772671885453-pe84ywpuh": {
        // 吉田 (voice有り) = 吉田(愛)
        name: "吉田(愛)",
        company: "INAHO", department: "CX / SSF・INOBE", role: null, type: "internal",
        nameVariants: ["吉田(愛)", "愛ちゃん"],
    },

    // === 括弧付き名前 → 名前分解 + 会社設定 ===

    // 長尾(アシッドハウス) → name: 長尾, company: アシッドハウス
    "member-1770262238236-o5vbc1zfl": {
        name: "長尾", company: "アシッドハウス", type: "supplier",
    },

    // 島田さん（ITONAMI) → name: 島田, company: ITONAMI
    "member-1771229146608-qu5qptrkp": {
        name: "島田", company: "ITONAMI", type: "supplier",
    },

    // 山脇さん（ITONAMI) → name: 山脇, company: ITONAMI
    "member-1771229206319-7zw4279ej": {
        name: "山脇", company: "ITONAMI", type: "supplier",
    },

    // 武田（WABI) → name: 武田, company: INAHO, dept: CX / WABI
    "member-1771229383131-8924weztq": {
        name: "武田", company: "INAHO", department: "CX / DENIM GALLERY WABI", role: "店長", type: "internal",
    },

    // 島田さんHUMANMADE → name: 島田, company: HUMAN MADE
    "member-1770864543292-l58jemi0e": {
        name: "島田(HUMAN MADE)", company: "HUMAN MADE", type: "client",
    },

    // 咲間さん（JOIX） → name: 咲間, company: JOIX
    "member-1770698661352-7muwmacqk": {
        name: "咲間", company: "JOIX", type: "client",
    },

    // 岸本さん（JOIX） → name: 岸本, company: JOIX
    "member-1770698676746-u3t8m44be": {
        name: "岸本", company: "JOIX", type: "client",
    },

    // 北野(タキヒヨー) → name: 北野, company: タキヒヨー
    "member-1772433017108-75q80ary2": {
        name: "北野", company: "タキヒヨー", type: "client",
    },

    // 桑原(タキヒヨー) → name: 桑原, company: タキヒヨー
    "member-1772433029089-2pu6gksqf": {
        name: "桑原", company: "タキヒヨー", type: "client",
    },

    // トマトリース近藤 → name: 近藤, company: トマトリース
    "member-1770959178307-1o9b96yoe": {
        name: "近藤(トマトリース)", company: "トマトリース", type: "client",
    },

    // 室山(JB) → name: 室山, company: ジャパンブルー
    "member-1772530075391-uf5w36x30": {
        name: "室山", company: "ジャパンブルー", type: "client",
    },

    // 原田さん → name: 原田(東京) — 区別用
    "member-1771979692419-f2p2pkmks": {
        name: "原田",
    },

    // === 難波 (INAHO PS/生産管理) ===
    "member-1773032844172-qtl64q8bw": {
        company: "INAHO", department: "PS / 生産管理", role: null, type: "internal",
    },

    // === インドネシア関連 ===
    "member-1771735412644-or22m9x7v": {
        // オスカル
        company: "INAHO", department: "IMID", role: null, type: "internal",
    },
    "member-1771985054028-cgh2yeewt": {
        // カルティワン
        company: "INAHO", department: "IMID", role: null, type: "internal",
    },
    "member-1771985059268-9n1jrgxg9": {
        // リタ
        company: "INAHO", department: "IMID", role: null, type: "internal",
    },
    "member-1771985064050-u26vr7c22": {
        // ヌル
        company: "INAHO", department: "IMID", role: null, type: "internal",
    },

    // === 田中豪 ===
    "member-1771389716636-rvkco13op": {
        // 田中豪
        company: "INAHO", department: "経営管理室", role: null, type: "internal",
        nameVariants: ["田中豪", "豪さん"],
    },
    // 田中光
    "member-1771389740403-qqnzumrfv": {
        company: "INAHO", type: "internal",
    },

    // 上村
    "member-1770617150732-mbscksgup": {
        company: "INAHO", type: "internal",
    },

    // 塚越 (INAHO internal) — voice有り
    "member-1770617178762-z8avmp01c": {
        // 塚越 (ジャパンブルー) → already set as client, OK
    },

    // 田淵 (美東) → supplier OK
    // 古川、いの → context unclear, leave as-is
};

// 重複削除リスト（voice無し重複を削除）
const DUPLICATE_IDS_TO_REMOVE = [
    // 古本の重複 (voice無し)
    "member-1771913933563-ituvfc7ij",
    "member-1771914058013-ujeowwaet",
    "member-1772160365761-llg44kxtc",
    // 山崎の重複 (voice無し)
    "member-1771913953490-nxecoxkoh",
    "member-1771914063667-0v7ttdzn5",
    "member-1772160378216-hpp03pt82",
    // 宇野の重複 (voice無し)
    "member-1771913959375-d2uglfprw",
    "member-1771914068718-9jix4frjb",
    "member-1772160372911-xz3zzq9sc",
    // 難波の重複
    "member-1773032896189-bmb3ae2gi",
    "member-1773637576425-r0xzxnzcs",
    // 田辺の重複 (voice無し)
    "member-1770275832964-gbxxvtra1",
    // 松本の重複 (voice無し)
    "member-1770275857633-ugtcr367y",
    // 室山の重複 (voice無し)
    "member-1772530089337-cuhgwwp8s",
    // 田中辰 (voice無し、田中辰巳が有り)
    "member-1771735422615-a20ksd8q5",
];

async function main() {
    // 1. 現在のデータを取得
    const { data: configData, error: fetchErr } = await supabase
        .from("tenant_configs")
        .select("data")
        .eq("tenant_id", TENANT_ID)
        .eq("config_type", "members")
        .single();

    if (fetchErr || !configData) {
        console.error("❌ Fetch error:", fetchErr);
        return;
    }

    let members = configData.data.members || [];
    console.log(`📋 現在のメンバー数: ${members.length}`);

    // 2. 重複を削除
    const beforeCount = members.length;
    members = members.filter(m => !DUPLICATE_IDS_TO_REMOVE.includes(m.id));
    const removedCount = beforeCount - members.length;
    console.log(`🗑️  重複削除: ${removedCount}件`);

    // 3. 組織図データで更新
    let updatedCount = 0;
    for (const member of members) {
        const updates = ORG_UPDATES[member.id];
        if (!updates || Object.keys(updates).length === 0) continue;

        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                member[key] = value;
            }
        }
        member.updatedAt = new Date().toISOString();
        updatedCount++;
    }
    console.log(`✏️  更新: ${updatedCount}件`);

    // 4. 保存
    const { error: saveErr } = await supabase
        .from("tenant_configs")
        .update({
            data: { members },
            updated_at: new Date().toISOString(),
            updated_by: "system (org-chart-sync)",
        })
        .eq("tenant_id", TENANT_ID)
        .eq("config_type", "members");

    if (saveErr) {
        console.error("❌ Save error:", saveErr);
        return;
    }

    console.log(`✅ 完了！ 最終メンバー数: ${members.length}`);

    // サマリー出力
    const internal = members.filter(m => m.type === "internal");
    const client = members.filter(m => m.type === "client");
    const supplier = members.filter(m => m.type === "supplier");
    const other = members.filter(m => !m.type || m.type === "other");
    console.log(`   社内: ${internal.length} / 顧客: ${client.length} / 仕入先: ${supplier.length} / その他: ${other.length}`);
}

main().catch(console.error);

# Lessons

- AI 規則只寫 AI 需要採用的 tool output、契約與計價判斷；不要寫 `backend 會...`、SQL、matcher 或自動觸發的內部實作說明。
- 方鐵也有切工；材料 query 要自動觸發 cutting catalog，並以方鐵邊長選最相近的圓條切工基本價。只借價格，不可連圓條不切或管類加價一起套用。
- 最新切工查詢契約是材料 `queries` 自動觸發 `steel.cutting_prices`，不需要 processingQueries 明示加工/切工；但 backend 必須用材料 query results 跑 candidate-aware matcher，只回 category、尺寸、厚度、nominal inch、normalized spec 相符的切工。
- v4.4 加工價模擬不能只統計 `steel.prices` 的加工 rows；長條料與方鐵另有自動觸發的 `steel.cutting_prices` 切工 catalog，必須用 v4.4 材料候選與正規化 cutting workbook 一起 replay。
- 頂層 productNames 的值必須是 backend 前輪返回的 `steel.prices.product_name` 完整原值；repository 用 `p.product_name = ANY(...)` exact equality，禁止 keyword、alias、ILIKE 或 normalized text 比對。
- 頂層 `{"productNames":[...]}` 只能作 AI 第二段 requery：必須先由 queries/processingQueries 探索並收到 backend productNames 清單，才可用它精確取得 prices；首查禁止 productNames。這個跨回合時序由 tool description 與 AI rules 固定。
- 精確品名取價必須允許只送頂層 `{"productNames":[...]}`，不要求重送材料或加工 queries；schema 只有在 queries、processingQueries、productNames 全部缺少時才拒絕。AI rules 要提供可直接執行的 requery JSON 範例。
- Backend 已固定過濾折工亂碼後，AI rules 不得重複 Unicode／亂碼辨識邏輯；只需規定沒有精確可讀折工價時直接 manual_review 且不得 requery／借價，避免浪費 prompt tokens。
- 折工 price data 含亂碼，或排除亂碼後沒有可判讀的精確價格時，規則必須直接送 manual_review；不得 requery、不得用 productNames 重取、不得猜形狀或借相近折型。只有可讀且能精確對應的折工價格可正常採用。
- `加工/折工` product_name 含 Unicode Private Use Area 或 replacement character 時視為不可判讀亂碼，backend 與 v4.4 模擬都直接排除；不得把亂碼品名回給 AI、不得靠 ERP 或相近折型猜價。
- 頂層 productNames 是獨立精確取價 mode：request 只帶 `productNames`，不需要也不接受 queries、processingQueries 或其他 params；探索 mode 才使用 categories/processingCategories/keyword。
- 加工探索超過10筆時只回全部唯一 `productNames`，不回價格明細；AI 選定後以頂層 `productNames` requery 取得全部明確指定品名的價格，不再套10筆結果上限。這是正常兩段式查詢，不是 error。
- `search_price_candidates` 的加工查詢必須支援同一訂單一次帶多組 processing queries：訂單可同時包含不同鋼材 category，也可同時需要切工、孔、折工等不同加工；不可把整張訂單壓成單一加工 keyword。每組固定最多10筆，整次呼叫另設固定總上限避免 context 膨脹。
- 尚未匯入 DB 的新版價格 workbook 驗證，必須直接由指定版本 xlsx 模擬 `search_price_candidates`；不可用舊 DB 回傳推論新版分類或加工候選。DB 只可用來核對現行查詢語意，測試證據與筆數一律來自新版 workbook。
- 價格 workbook 大規模 normalization 必須先以腳本輸出獨立的新 xlsx 驗證，不可直接覆寫 `docs/products_db_v4.3.xlsx`。腳本需拒絕 input/output 同一路徑，以 product_name 推導 category 並逐列對照 protected category；任何 mismatch 都要中止，不可靜默沿用。
- 新版價格 subcategory 名稱要利用 category 已提供的上下文，採精簡名詞，不重複 `C型鋼/H型鋼/方鐵/鋼筋/槽鐵` 等 category 字樣。例如 C型鋼使用 `加工/輕型/成型/其他`，H型鋼使用 `輕量/標準`，方鐵使用 `切料/加工/磨光/標準`。
- Steel 價格 workbook 的面積 canonical unit 是 `㎡`；normalization 方向固定為 `m2`／`M2`／`平方公尺` → `㎡`，絕不可反向把 `㎡` 改成 `m2`。
- 價格 parser 不得只因 `product_name` 含「熱浸鍍／熱進鍍」就覆寫 `material`；必須先確認 `category` 是適用的材料／鍍鋅加工類別。像 `五金/配件 > 油漆` 的「合金底漆(白鐵熱浸鍍鋅用)」是在描述用途，不是產品材質，必須保留原 material。
- 使用者要求價格 xlsx 新增 `thicknessMinMm`／`thicknessMaxMm` 時，header 必須採使用者指定的 exact camelCase 名稱；不可自行改成 snake_case。欄位應由 parser 的實際厚度區間輸出填入，並納入 importer exact-header、normalization script 與 readback tests。
- 更新既有價格 workbook 以反映「上輪 parser 調整」時，必須比較調整前後 parser 的實際輸出，只回寫該輪新增／修正規則造成的欄位差異；不得把早已存在的通用正規化（例如所有 `0 -> null`）誤當成本輪修正。若使用者鎖定價格欄，品名命中 `沒做|勿用|沒出|沒貨|不生產|不用|沒現貨|無生產` 時只回寫 `value_state: no_price`，不得清空 workbook 的 `unit_price_*`／`price_ratio_*`。
- 所有 modal 都必須有獨立 UI/UX lifecycle：open state、流程 state、mutation 與 render host 不可依附短生命週期的 menu/popover/list row；其他 UI 關閉、切換或 unmount 不得連帶關閉、重設或干擾 modal。
- OpenAI OAuth Login／Logout modal 必須掛在 model list 內容之外的持久 provider 層；關閉 model list 只能 unmount Usage/endpoint rows，不得連帶清除或關閉 modal 與其 mutation 狀態。
- Logout confirm modal 在 Confirm 後不得自動關閉：執行中顯示 `Logging out...` 且禁止關閉，完成後在同一 modal 顯示 `Logged out`／`Logout failed`，由使用者自行 Close。
- OAuth Logout 必須先顯示確認 modal；點擊原 Logout 只開 modal，只有 Confirm 才能觸發 logout mutation，Cancel／Close 不可登出。
- OAuth token refresh 與 Usage remaining refresh 是兩個獨立動作：登入後的文字按鈕只 refresh token；Usage remaining section 右上 icon button 才 refetch usage，不可讓 token refresh 隱式刷新 usage。
- Usage window 的 `primary`／`secondary` 是位置 key，不是固定週期語意；必須以 `limit_window_seconds` 判斷 5h／weekly。實際 WHAM 可回 `primary_window = 604800`（weekly）且 `secondary_window = null`，不可固定把 primary 顯示為 5h、secondary 顯示為 weekly。
- Login Codex modal 的 Close、Esc 與外部關閉都等同取消 login：pending 時先取消 backend session，完成後清除 sessionStorage、polling query 與 local mutation state，不能只把 modal 隱藏。
- Browser OAuth login 從 mutation loading 開始就只能顯示一個 Login URL skeleton；UI 必須保留使用者剛選的 login method，不能等 status response 才判斷是否隱藏 verification-code skeleton。
- Browser OAuth login details 只有 Login URL 單欄，不應顯示步驟編號 `2`；只有 device-code 的驗證碼＋URL 雙步驟流程使用 `1`／`2`。
- OAuth token action 判斷不能只依可能過期的 token status snapshot；當目前 login flow 明確為 `failed`、`unavailable` 或 `login_timeout` 時，必須優先顯示 Login，不可繼續顯示 Logout。
- OAuth token 的 Login／Logout 是互斥顯示契約：依實際 token 登入狀態只 render 其中一個，不可同時 render 後再用 disabled 隱含狀態。
- OpenAI OAuth Login Codex modal 選定 device-code 或 browser 登入方式後，必須提供 Back 回到登入方式選擇；Back 要清除目前 frontend session/polling state，不能只切換畫面而保留舊 session。
- Steel `system_order` Markdown 的 `數量`、`單重`、`總數`、`單價`、`厚度`、`寬度`、`長度`、`肚`只能填純數字；不得混入單位、符號或補充文字，無資料留空，補充資訊一律移到`備註`。
- 類別規則中的 `search_price_candidates` 範例不可只看字面合理；每個 JSON 都要對 dev/prod live `steel.prices` 重播，分別記錄「有 candidate」與「有 `quoteEligible` 價」。例如方管 `150x6` 雖命中 GDB15060，但只有不可用的非 Kg/M ratio，應改用 `100x6` 作可報價範例，並明載 150x6 須人工複核。
- 切工 candidate-aware matcher 若同時命中一般尺寸 key 與更精確的複合尺寸 key，必須優先複合 key；例如槽鐵 200x90 不可同時回傳一般 `200` 與精確 `200x90` 兩個價格。
- Candidate-aware `cuttingPrices` 應保留材料與切工 catalog 的並行 Supabase 查詢，再由 backend code 於兩邊返回後 post-filter；這能降低 AI token 而不增加 DB round-trip。篩選不只處理 base price，補充規則也必須依 candidate 的類別、材質與尺寸排除不適用列。
- `search_price_candidates` 首次查價的 `keyword` 只能使用通用產品名稱與規格，不得自行使用來源資料中的專有品名、廠牌、系列名或 DB token；例如使用「鋼管」，不得自行使用「黑A鋼管」。只有用戶原文明確指定該專有名詞時才可原樣保留；候選 product_name 不得反向成為初查或修正 query。
- 已由 `category`／`subcategory` 表達的通用類別名稱不得重複放入 keyword；例如平鐵、角鐵、方管、扁方管、圓鐵、方鐵、槽鐵只保留尺寸規格 keyword。類別詞只有在 category discovery 或用戶明確指定且確有辨識必要時才使用。
- C型鋼訂單常見格式如 `C 125x2.5 2.3 4m`：首次查價未指定材質時預設 `material: "錏"`；一般材料 keyword 使用截面規格與厚度，但長度不得列入 keyword，因材料按 Kg 計價；樑柱初查的 keyword 只用 `樑柱`；未提供厚度時，在其他條件相符的可報價候選中採最薄厚度。
- 逐類別整理 Steel keyword 規則時，每個已確認類別只更新本地 `docs/rules`；不得逐類別同步 `steel.rules`。等所有類別都討論、確認並完成本地修改後，才依使用者指示一次 dry-run、apply 與 DB readback。
- `search_price_candidates` 必須由 backend 候選查詢代碼固定排除 `value_state: "no_price"`，不得把這項限制寫進 AI rules，也不得讓 no-price rows 返回給 AI 判斷或重查；排除後沒有可用候選時，才依既有 no-match/manual-review contract 處理。
- `stockLengthMm` 採容錯正規化：不合規元素一律靜默移除，不得因單一壞值拒絕整筆 query。H型鋼最短可用母材為 6M，並額外由 tool 代碼移除 `< 6000mm` 的有效數字，`6000mm` 保留；H 型鋼門檻不可誤套其他價格類別。
- 鐵板同材質、同厚度、同 unit 的價格候選，使用者未指定加工關鍵字時由 backend 依 `雷射切割 -> 四方切 -> 版型切型` 固定順序選價；使用者明確指定其中一種時，只採指定加工類型，不套預設 fallback 順序。這個排序應由代碼保證，不交給 AI 從大量候選自行猜選。
- 價格查詢的 material parse／alias 正規化必須套用所有類別，不可只為鐵板特判；例如輸入 `NO1` 要匹配 DB `白鐵 / NO1`，輸入 `2B` 要匹配 `白鐵霧面 / ST 2B`，HL/BA 與沙面/亮面同理。只有鐵板的「未指定材質預設黑鐵」及「泛稱白鐵依厚度預設 2B/NO1」是 category-specific default。
- 鐵板價格匯入不得把表面代碼 `2B` 的 `2` 或 `NO1` 的 `1` 誤認為厚度；parser 應優先從產品名稱辨識實際板厚並覆蓋污染的 source thickness，例如 `ST2B 3.0` -> 3mm、`10.0m/mSTNO1` -> 10mm。使用者要求先修 parser 與本地 parsed data 時，不得提前重匯或更新 Supabase data。
- 價格 query 的 unit filter 適用所有類別，其他類別必須保留 AI 傳入的 unit 原值並用於查詢。只有鐵板有 category-specific 正規化：unit 缺省時預設 `Kg`，`Kg`/`kg` 保留為 `Kg`，其他值一律轉成 `片`。
- `unit: 片` 時保留全部尺寸候選並禁止 AI 用尺寸重查，僅限鐵板。`value_state: ratio_only` 且 `unit: Kg` 將 `price_ratio` 轉成一般 `tier_price` / `tierPrices` 輸出則是所有價格類別的通用 backend 邏輯，不可限制在鐵板。
- `search_price_candidates` 的自動 `cuttingPrices` 不可只依輸入 category 回傳整包切工目錄；應先完成材料查詢，再以實際命中的 candidate 規格做類別專用匹配。材料 `no_match` 時不得附上該類切工，否則既增加 context，也會讓模型誤以為已有可套用切工。
- 方管價格資料的 canonical keyword 只寫一次邊長，例如圖面 `150x150x6` 要查 `category: "方管" + keyword: "150x6"`；不能把完整方形截面直接當 DB keyword。所有 canonical query 都必須以 live `steel.prices` 的實際 `normalized_spec` 驗證。
- Production 出現第二次 `search_price_candidates` 時，要先區分「模型針對部分 `no_match` 的 repair/retry」與 backend 自動切工 enrichment。切工 catalog 不會自行觸發第二次 tool call，但重複回傳整包 catalog 會大幅放大第二輪 context；已成功 query 與完全未改寫的失敗 query 都不得重送。
- Steel `search_price_candidates` 的首次查價永遠以已判定的 `category` 為基礎；`erpItemCode` 是價格資料返回後才能取得的識別欄位，不能寫成首次查價優先策略。只有使用者原始輸入明確提供 ERP 料號時，才可在首查同時傳入。
- Grouped `search_price_candidates` 只應套用各 query 自己的 `limit`；不得再用整批總 limit 截斷 `queries`、`queryResults`、跨 query candidates 或 source refs，否則後面的訂單列即使各自未超限也會從 AI context 消失。
- H/C/I/槽鐵/角鐵/圓管/方管/扁方管等具有多維複合規格的類別，首查必須使用 `category + canonical keyword`，不能只靠單一 `thicknessMm`。平鐵、圓鐵、方鐵、鐵軌及大型商品目錄類別也因 structured 欄位缺漏或過寬，需要在 category-based 首查同筆加入可確認的品名/規格 keyword；取得可用候選後禁止改寫同規格或 limit 重查。
- H 型鋼價格候選的 `unitWeightValue` / `kg_per_piece_or_stock_length` 是 `lengthMm` 對應母材整支總重，不是 kg/m。報價必須先除以母材長度換算 kg/m，再乘成品長度與數量；不得為了找成品同長 row 反覆查價。
- Steel 各具體類別的首查形狀必須先以 live `steel.prices` 證明。每筆一律帶 `category`；structured 欄位可靠且具選擇性時才加 `subcategory`、`material`、`thicknessMm`，複合規格或大型商品目錄則同筆加入 canonical 品名/規格 `keyword`。不得用跨類別 blanket 規則禁止 keyword，也不得在沒有資料證據時通用化 `thicknessMm`。
- Steel runtime 類別規則順序必須先放所有具體類別規則，最後才放 `docs/rules/類別規則/查價方式.txt` 通用查價規則；以 DB `priority` 與 build/sync 順序共同鎖定，不能只依檔名排序。
- Steel 查價首次 lookup 一律以已判定的 `category` 為基礎，再依該類 live 資料加入 structured filters 或 canonical keyword。只有 category 未知時才先使用 `mode: "category_discovery" + keyword`。`erpItemCode` 是 DB 候選返回值，不是首查前提；候選已返回就直接採用，不能為同一列再用 ERP 重查。`ST50`、`SN400B` 等表單代號只留在判讀/備註。
- 加工/孔厚度區間一律是半開區間：下限「以上（含）」、上限「以下（不含）」，即 `min <= thickness < max`；只有 `min = max` 的單一厚度列使用精確匹配。不可把一般區間的上限當作可命中端點。
- Steel material-unit defaults are category-specific: C型鋼、H型鋼、方鐵、鐵板 prefer Kg and must go to manual review when no usable Kg price exists, unless the request explicitly says `不切清`, which permits M/支/other direct units. 槽鐵、角鐵、鐵軌、圓管、圓鐵、平鐵、扁方管、方管、網 default to `不切清` and prefer 支/只/片; 板/浪板 pricing is length-led. Preserve precise intermediate values and ceil each final material-line subtotal to an integer TWD.

- The canonical Steel `system_order` output has exactly 16 columns in this order: `型號`, `品名規格`, `材質編號`, `單位`, `數量`, `單重`, `總數`, `單價`, `計價基準`, `公式編號`, `厚度`, `寬度`, `長度`, `肚`, `類別`, `備註`. Assistant Markdown capture eligibility is intentionally tolerant: under a `system_order` heading, a table containing `型號` must persist even when legacy fields such as `項次` are absent or other columns are imperfect.
- OCR preprocessing organizer 的 reviewed OCR 規則必須明確寫出硬邊界：只可把 backend 提供的單一 PaddleOCR raw result 依 OCR 規則整理成 Markdown，不得呼叫任何 tool、補查資料、查價或進入報價流程。runtime 仍應用 tool isolation 落實此邊界，不能只依賴 prompt。

- `OPENAI_DEFAULT_MODEL` defines the default model shown for a new LibreChat
  conversation. OpenAI OAuth must continue using the model selected in the
  LibreChat UI; the env value is only the default/fallback and must never
  overwrite an explicit UI-selected model.
- For grouped Steel price lookup, backend query IDs come only from `queries`
  array order (`q1`, `q2`, ...). Ignore caller-supplied `queryId` values, keep
  `queryResults` in the same order, and never reject a batch for ID collisions.
- For Steel cutting-price enrichment, finish every normal grouped price query
  first, derive unique cutting terms from the selected product categories, and
  run one final unlimited contains query. Return one top-level cutting catalog
  with query/category provenance instead of duplicating cutting rows per item.
- Cutting category matching is always contains-based. Preserve source labels
  such as `鐵板/平鐵`; only map `圓管`, `方管`, and `扁方管` to the lookup term
  `鐵管`.
- The Steel ERP output field is `肚`, not the homophone `度`. Gate it only by
  formula code DA/DB/DC, never by product category, and leave it blank for
  manual review until a real derivation rule exists.
- When the user says they replaced an in-scope workbook during an active
  implementation, stop any planned workbook edit and re-read the current file
  before continuing. Do not apply a correction to a stale imported snapshot.
- Treat authoritative structured price datasets as reviewed, searchable source
  rows regardless of `value_state`: keep `confirmed`, `ratio_only`, and
  `no_price` active/reviewed, and enforce quote eligibility separately.
- In Steel price parsers, normalize zero placeholders to null for optional
  physical measurements as well as prices and ratios; zero dimensions are not
  measured values.
- Steel price lookup limits above the AI-visible maximum are a clamp contract,
  not an invalid-arguments path: keep the default at 30 and normalize every
  positive value above 100 to 100.
- Batched `search_price_candidates` output must preserve query provenance.
  Group candidates by a stable query ID and deduplicate only within that group;
  the same price row may legitimately serve more than one order line.
- `steel.prices.spec_key` is keyword-search text (`ERP + normalized spec`), not
  row identity. Use `erp_item_code` as the sole unique/upsert key.
- Store ratio prices independently from direct tier prices. Only Kg/M ratios
  are quoteable until a category rule defines another unit; return an explicit
  skipped marker for unsupported units instead of guessing or dropping them.
- Reviewed Steel domain rule folders and wording are now `類別規則` / category
  rules. Category-specific search shapes belong there, while generic tool
  envelope and retry behavior stays in `agent規則.txt`.

- Codex CLI device-login output is streamed prose. Never extract a device code
  with a global `AAAA-BBBBB` fallback across the full output, because text such
  as `Open this` can become `OPEN-THIS`. Also do not treat generic title text
  like `device code` as a prompt; accept codes only from line-scoped
  `Enter/Use/... code` prompts, and keep a frontend guard against stale invalid
  cached codes.
- When tuning OCR markdown latency, keep the PaddleOCR raw-to-Markdown organizer
  on its existing `reasoningEffort: "none"` unless the user explicitly confirms
  changing that component. The main-agent OCR Markdown review path is a separate
  reasoning-effort control from the organizer/subagent call.
- For OCR streaming regressions, do not treat "the provider supports
  `doStream`" as proof that a large OCR answer will visibly stream. Separate
  three timings: preflight/organizer work, main LLM start, and first visible
  `text-delta`; long reasoning/input-processing can make the upstream produce
  no displayable text until near completion.
- For streaming bugs where the UI sees `on_message_delta` without a visible
  run step, verify the backend graph contract before declaring the provider path
  omitted `on_run_step`. Native OpenAI OAuth text should flow
  `text-delta -> AIMessageChunk -> ChatModelStreamHandler`, which emits
  `MESSAGE_CREATION` before the matching text delta; if the UI lacks that step,
  inspect resume/replay/step-map loss separately from Steel activity events.
- OCR preprocessing activity labels are user-visible contracts. Use verb-first
  completed wording such as `Saved PaddleOCR preflight`, and keep
  preprocessing Markdown as one merged same-file-key source block. The
  canonical file-keyed OCR title belongs to the main agent's final OCR output,
  not the preprocessing attachment.
- When a user reports a visible regression after a recent change, first confirm
  whether the symptom predates the diff before attributing cause to the current
  patch. For title/UI issues, inspect existing DB rows, timestamps, cache/log
  evidence, and frontend state before assuming the latest code created the
  backlog.
- When enabling S3 storage, update both the code/env path and the ignored
  runtime `librechat.yaml` source. Local/dev should use `fileStrategy: "s3"`
  plus `.env` `S3_KEY_PREFIX=dev`; the private production server uses
  `.env.prod` installed as `/etc/librechat/.env.prod`, and should use
  `fileStrategy: "s3"` plus `S3_KEY_PREFIX=prod` when sharing the bucket with
  dev/test.
- Production PaddleOCR preparation must not block LibreChat rollout. Do not keep
  a strict prewarm env or startup MCP smoke gate; AI Studio dependency failures
  should remain warnings while `/health` can recover.
- After deployment, use `/health` only to confirm the LibreChat site started.
  Run PaddleOCR smoke separately by passing the freshly obtained S3 smoke PDF
  URL as the smoke command argument. This checks both S3 URL readability and the
  PaddleOCR `fileUrl` OCR path.
- When switching LibreChat production file storage to S3, verify the running
  container with a server-side put/get/delete smoke test and log
  `[initializeS3]` before claiming uploads are backed by S3. Never print AWS
  secret values during this check.
- For PaddleOCR `fileUrl` downloads from private S3, use long enough
  presigned URLs for async OCR and retry windows. Current production standard is
  `S3_URL_EXPIRY_SECONDS=43200` for 12 hours, without making the bucket public.
- PaddleOCR MCP attachment resolution must prefer storage `getDownloadURL` for
  S3 current-request files and must not log the generated presigned URL.
  CloudFront should stay on the stream fallback unless signed URL mode is
  explicitly verified. Keep the existing owned-file DB lookup before
  resolution; never trust a request-supplied filepath directly.
- When PaddleOCR fails on the second image turn after the first turn completed,
  do not assume concurrent access. Check production logs for provider/network
  reset errors and verify with both same-client and fresh-process smokes before
  adding locks. Sequential reset handling should rebuild the PaddleOCR MCP
  connection and retry only the affected file once.
- Same-turn automatic PaddleOCR preflight output must be AI-visible as
  authoritative OCR evidence for the current file. If
  `attachments.currentPaddleOcrResults` contains the current file key, the
  runtime policy should tell AI not to call `read_markdown` or rerun
  `paddleocr_vl` for that file unless the user explicitly asks to rerun OCR or
  the result is absent/failed.
- Same-turn `attachments.currentPaddleOcrResults` must preserve the full
  PaddleOCR result. Do not token-limit or hard-truncate
  `toBoundedSteelPaddleOcrValue`; otherwise the AI sees incomplete OCR evidence
  and incorrectly calls `read_markdown` for the current file.
- Native Steel context must pass current file metadata into both
  `Steel Native File References` and
  `Steel Runtime Context.attachments.currentTurnFiles`; leaving runtime
  `currentTurnFiles` empty weakens the current-file OCR policy.
- Steel AI-visible tool output and tool-result memory must not hard-truncate
  strings, arrays, object keys, or nested JSON. Remove helpers such as
  `toBoundedJsonValue` and sanitizer caps; keep only safety redaction and
  circular-reference guards.
- OCR dedupe must be source-aware per file key. `ocr_extract` rows from
  assistant Markdown / AI OCR fallback are useful review state, but only
  active rows with `ocrSource: "paddleocr_mcp"` may skip future PaddleOCR
  preflight for the same `ocrFileKey`; PaddleOCR failures must not write
  completed OCR state so the next turn retries.
- `read_markdown(scope: "ocr")` must include active PaddleOCR preflight raw
  evidence as OCR evidence, labeled separately from assistant OCR Markdown, so
  compact-context recovery does not hide successful PaddleOCR output and cause
  duplicate OCR calls.
- PaddleOCR MCP input resolution must treat Steel/LibreChat `file:<fileId>`
  values as owned file-key aliases before calling MCP. Never pass `file:<id>`
  directly to `paddleocr-mcp`; it only accepts MCP-visible paths, URLs, Base64,
  or data URLs.
- PaddleOCR MCP `input_data` normalization should extract canonical supported
  tokens from model text instead of chasing individual AI-added prefixes.
  Recognize `data:`, `http(s)://`, `file:<id>`, raw file ids, and
  label-stripped forms such as `file_url:` or `source=`; resolve owned current
  files first, then pass supported direct URL/data inputs through. Direct local
  paths such as `file://...`, `/tmp/...`, `./...`, or `../...` must not be
  passed to PaddleOCR unless they only match an owned current file that the
  backend rewrites to a controlled URL/data URL.
- `read_markdown` should support per-file reads for both OCR and workbook
  state. Use aggregate OCR only to list available file keys / short evidence;
  fetch full OCR Markdown one file at a time with `ocrFileKey` to avoid
  truncation. For workbook, no `fileKey` means the combined current workbook;
  `fileKey` means multiple OCR files / text orders have separate workbook
  orders and only that file's rows should be returned. Text/manual/default
  workbook rows use the fixed `fileKey`/`ocrFileKey` value `default`.
- OCR Markdown table parsing must keep a structured OCR heading as the pending
  table title when metadata lines such as `file key: file:<id>` appear between
  the heading and table. Do not let metadata replace the OCR title or
  title-gated `ocr_extract` capture will skip valid fallback Markdown.
- If a user says a file's OCR state is fallback / assistant OCR, treat that as
  not PaddleOCR-complete even when it has the same filename or `ocrFileKey`.
  Edit-message resend must rerun PaddleOCR preflight unless there is active
  successful `paddleocr_mcp` preflight evidence for that exact file key.
- For chat.longdin.org bug reports, local `MONGO_URI` points at dev Mongo and
  cannot prove production conversation state. Treat production Mongo as a
  separate source; do not use a zero-row local query to rule out prod data.
- PaddleOCR preflight raw result is not `read_markdown(scope: "ocr")` data.
  Store and label raw automatic PaddleOCR output as `paddleocr_preflight`; only
  assistant-organized OCR Markdown confirmation tables are `ocr_extract`.
  Same-turn raw preflight may enter `attachments.currentPaddleOcrResults`, but
  follow-up turns should use `read_markdown(scope: "ocr")` only when organized
  OCR Markdown is missing from normal chat history.
- OCR preprocessing PDF chunk artifacts must be indexed by the original stored
  PDF's S3 file key/storage key, not by `conversationId`. Store split PDF chunk
  artifact metadata in a global registry so another conversation using the same
  original PDF can reuse existing chunk PDFs; conversation-scoped
  `paddleocr_preflight` / `ocr_extract` rows should only reference that source
  key as OCR evidence state.
- OCR preprocessing must not persist a second full merged OCR Markdown row.
  Store organizer output per chunk only; at runtime, read the chunk Markdown
  rows and merge them into exactly one main-agent OCR Markdown attachment for
  that PDF file key. Raw PaddleOCR chunk results and per-chunk Markdown arrays
  are intermediate evidence/resume state, not main-agent context.
- OCR preprocessing resume state has two DB-backed nodes:
  `paddleocr_preflight` raw chunk rows for PaddleOCR progress and
  `ocr_extract` chunk Markdown rows for subagent progress. On retry, continue
  from the first missing raw chunk if raw is incomplete, otherwise from the
  first missing organized Markdown chunk.
- `read_markdown(scope: "ocr")` must return all OCR Markdown automatically for
  preprocessing PDFs, with each file's merged all-chunk Markdown labeled by
  `<file_key>`. Do not require the agent to ask for individual file/chunk parts,
  and do not return raw PaddleOCR chunks as the default OCR read when organized
  chunk Markdown exists.
- When checking a user's Steel OCR count report, distinguish per-event activity
  `savedCounts` from aggregate persisted state. Verify production
  `steel_working_order_memory` by `memoryKind`, `ocrFileKey`, `fileId`, and
  `state` before concluding raw OCR results were merged or overwritten.
- OCR file-key behavior must update both runtime capture/UI and AI-facing rules.
  When changing multi-OCR grouping, update `docs/rules/其他規則/OCR規則.txt` and
  `docs/rules/輸出規則.txt` together so first-turn OCR Markdown and later
  `system_order` output follow the same file-key boundaries.
- Steel activity aggregate fixes must cover both AgentClient and Open Responses
  streaming. Final assistant Markdown capture events need to be emitted before
  `res.end()`; otherwise preflight activity can appear while final aggregate
  totals are saved but invisible in the same UI turn.
- Steel automatic PaddleOCR preflight must pass document preprocessing runtime
  params explicitly. `output_mode: "detailed"` alone does not guarantee
  orientation classification, unwarping, or layout detection are enabled.
- Manual PaddleOCR UI smoke must use a text-bearing image or PDF. Decorative
  icons such as favicons are only suitable for checking that a preflight tool
  indicator appears; they do not verify OCR content or useful PaddleOCR output.
- When adding chat timing UI, distinguish whole-turn elapsed time from
  individual tool-call duration. If the user asks for AI message timing, place
  it on the assistant name row with timestamp-like styling, `ml-2` spacing, and
  compact `s`/`m` labels unless they explicitly ask for per-tool timing.
- Future Steel native LibreChat work must start from
  `docs/steel-native-librechat-master-framework.md`, then use
  `docs/plans/2026-06-24-steel-global-native-librechat-integration.md` for phase
  execution. Do not infer architecture from older v8.3/OAuth/OCR planning docs.
- Steel native LibreChat research conclusions belong in the master framework
  `Research Conclusions Lock` and the implementation plan checklist, not only in
  conversation history or task logs.
- Native LibreChat reconstructs context from LibreChat Mongo message history
  plus LibreChat Memory, instructions, MCP, skills, files/RAG, tools, and
  pruning/summarization. Steel must extend that path, not replace it with
  provider-only state.
- Current native `useResponsesApi: true` is reconstructed Responses transport,
  not automatic provider-state continuation. `openai_responses_previous_response_id`
  requires explicit OpenAI `response.id` persistence, lookup, call-option
  injection, and fallback tests.
- Steel-enabled Open Responses is durable and LibreChat-managed, equivalent to
  `store:true`. Do not design a Steel `store:false` branch.
- LibreChat user Memory is distinct from Steel structured quote/workbook state,
  even when existing Steel service names contain `Memory`.
- Steel Markdown capture must run after assistant message persistence succeeds:
  use a native UI post-save hook around assistant `databasePromise`, and hook
  Open Responses `saveResponseOutput()` after `db.saveMessage`.
- LibreChat file records and permissions remain canonical. When Steel needs
  provider vision for drawings/images/PDFs, keep the native file/vision path
  intact. When Steel needs OCR/table extraction or durable drawing evidence,
  use PaddleOCR MCP OCR (`PaddleOCR-VL-1.6` / `paddleocr_vl`) directly, then
  reuse persisted assistant OCR Markdown/file-analysis state on follow-up
  turns by default.
- `/steel/oauth-chat` is dev-only for smoke tests and activity-log inspection.
  Product behavior must live in native LibreChat hooks.
- Normal LibreChat chat must support OpenAI OAuth API through the native Steel
  provider adapter, not through `/steel/oauth-chat`. Keep OAuth mode stateless
  and reconstructed with `responsesState: false`; preserve native stream,
  abort/resume, files/vision, tools, permissions, and message persistence.
- When the user says `一次問我所有問題`, batch all unresolved design questions
  with recommended answers instead of continuing a one-question-at-a-time grill.
- Steel native framework is global. Do not add modelSpec opt-in, ordinary-chat
  classifier, or Phase 1 runtime disable-switch logic; AI decides whether the
  Steel quoting workflow is relevant from the request.
- All Steel-related native modules must be globally open by default. Do not add
  Steel-specific role, capability, or permission gates for Steel rules, context,
  quote/OCR behavior, or read-only AI tools; keep only existing LibreChat-owned
  file, MCP, provider/model, and admin-setting checks.
- Do not add `librechat.yaml` Steel enablement/inclusion switches for the
  native framework. Reuse existing LibreChat YAML surfaces such as modelSpecs,
  endpoints, and permissions only when they already own the concern. Do not use
  `fileAnalysis.instructions` as a duplicate Steel OCR-policy source; reviewed
  Steel OCR/file rules are authoritative.
- For native Steel context ordering, every prompt prefix section must map back
  to `docs/rules/*.txt` synced through `steel.rules`. Use the compact order
  `agent`, `quote_rules`, `output`, `other`. Do not add prompt sections for
  runtime-only tool configuration, duplicate reviewed-agent aliases, or empty
  legacy instruction packets.
- Steel runtime tool exposure is executable backend configuration, not a prompt
  rule section. Keep AI-facing tool behavior in `docs/rules/*.txt` and
  `steel.rules`, but do not let txt/DB rows directly decide which executable
  tools are exposed; code-owned filtering must remain the final guard.
- Phase 1 native Steel context should carry LibreChat attachment
  metadata/references, not duplicate uploaded file bytes or base64 bodies in
  prompt text. This does not mean hiding files from the AI; attachments still
  pass through LibreChat's native provider file/vision pipeline when supported,
  and PaddleOCR MCP OCR must use the permission-checked file path when
  structured OCR/table extraction is required.
- `run_file_ocr` is obsolete and must not be AI-visible. Do not design
  LibreChat file loading/upload as automatic OCR plus prompt injection by
  default; the agent uses PaddleOCR MCP OCR directly when structured OCR/table
  extraction or durable drawing evidence is needed.
- Do not add runtime OCR workflow gates such as `ocrWorkflow` or
  `policy_blocked` for `/steel/oauth-chat` or native Steel provider flows. OCR
  PDF quote flow is prompt/rule-guided: first turn AI returns OCR form results,
  user confirms, second turn AI quotes from the confirmed OCR form. Runtime
  should not block tool calls for that reasoning flow unless the user explicitly
  changes this architecture.
- Standard LibreChat native chat already sends reconstructed chat history to
  the provider. Do not duplicate prior assistant OCR/quote Markdown in Steel
  runtime context or `additional_instructions`; runtime context may use history
  for rule selection and metadata, but prompt-visible assistant tables should
  travel through normal chat history only.
- LibreChat native Steel needs its own chat/runtime context preparation. Do not
  directly reuse `/steel/oauth-chat` `prepareChatContext()` or the generic
  `prepareSteelRuntimeContext()` as native prompt context. Native LibreChat
  context should contain information outside chat content: reviewed rules,
  tool policy, workbook/quote state, file/evidence references, request IDs, and
  metadata. Chat text and assistant OCR tables belong to LibreChat provider
  history.
- Steel workbook/quote state originates from assistant response Markdown that is
  auto parsed and saved. Native runtime context should carry Markdown-derived
  summary/index metadata, not the complete assistant Markdown tables. The full
  table contract remains the assistant Markdown in chat history; if token
  compression loses it, the agent should call a read-Markdown style tool to
  retrieve the parsed/saved quote or workbook content from the database.
- Keep `read_markdown` as the only AI-visible/read-only Steel tool for
  Markdown-derived workbook/OCR state recovery. Do not keep a separate
  active-workbook row keyword reader as provider-visible, executable, or
  back-compatible Steel tooling; lookup must be active-conversation scoped with
  optional `scope` only, not row keyword search.
- `read_markdown` must return Markdown text for the AI, not raw DB JSON. Its
  scope is only `workbook` or `ocr`: workbook includes strict workbook/quote
  sheets, while OCR is free-form drawing/text extraction evidence that the AI
  organizes into updated OCR tables. Do not expose `all` or standalone `quote`
  scopes.
- Steel structured storage for a LibreChat conversation is current-only for one
  workbook dataset and one OCR dataset. Overwrite operations should replace the
  current workbook/OCR data instead of retaining older overwritten versions as
  queryable history.
- A LibreChat conversation maps to one current Steel workbook and one current
  quote/OCR dataset. Do not design multiple workbook/quote datasets per chat or
  AI-selected dataset lookup. Table retrieval should be conversation-scoped by
  backend context; tool args may select scope, but not conversation id, row
  patch strategy, or semantic query. Assistant table updates must output the
  complete table. Auto parse/save should whole-table overwrite the current
  conversation dataset from that complete Markdown, not decide row-by-row
  delete/update/retain or merge partial row patches.
- Backend Steel auto parse is a table-page merge, not business reasoning. When
  the latest assistant Markdown includes complete tables, parse each recognized
  table and replace that corresponding workbook/quote sheet in the current
  conversation singleton; sheets not present in the latest response carry
  forward from the database. Do not infer row deletes/updates/retains inside a
  sheet.
- When the user confirms or corrects prior OCR/table content, the AI should not
  rerun PaddleOCR MCP OCR unless the user explicitly asks to rerun OCR or
  attaches new/changed file evidence. The AI should update the OCR/quote
  Markdown directly from chat history plus user corrections, return the
  complete latest OCR/quote table, and let backend auto parse/save update the
  conversation singleton.
- `read_markdown` is a recovery tool, not a per-turn default. The AI must first
  use LibreChat provider chat history when the needed OCR/workbook Markdown is
  present and complete enough; only call `read_markdown` when history was
  token-compressed, truncated, or lacks the complete Markdown needed for the
  update/quote.
- Delete duplicate Steel tools instead of hiding them when their function is
  replaced by native context or `read_markdown`. `lookup_quote_rules` should not
  exist because reviewed quote rules are injected into runtime context, and
  `read_working_order_items` should not exist because current workbook/OCR
  recovery is handled by `read_markdown`.
- `OpenAI (OAuth)` should be a first/default normal LibreChat provider-model UI
  choice for the native `openai_oauth_responses` path. Selecting it changes only
  provider/model transport; Steel tools, OCR, quote auto-parse, Markdown
  recovery, and runtime context must stay shared native Steel modules.
- OAuth usage remaining comes from the ChatGPT WHAM usage endpoint
  (`/backend-api/wham/usage`), not `/backend-api/codex/usage`. Fetch it
  server-side with the Codex OAuth bearer token, cache briefly, and sanitize
  before reaching the browser. Never expose OAuth tokens, account IDs, emails,
  auth file paths, or raw usage JSON in LibreChat UI/API responses.
- `OpenAI (OAuth)` must not replace or hide the original `OpenAI` API-key
  endpoint. Keep the OAuth provider first/default, but when `OPENAI_API_KEY` is
  absent the original OpenAI endpoint should stay visible through LibreChat's
  existing user-provided API key flow.
- When enabling the original `OpenAI` endpoint without a server
  `OPENAI_API_KEY`, update both the selector config and the runtime
  `initializeOpenAI()` key resolution. A visible user-provided OpenAI setting is
  incomplete unless runtime reads the saved Mongo `Key` record.
- For native LibreChat file-only Steel OCR turns, fix both UI affordance and
  submit pipeline. Enabling the send button is not enough because
  `useChatFunctions.ask()` rejects empty trimmed text; `useSubmitMessage()` must
  provide the default OCR review prompt before calling `ask()`.
- For native `OpenAI (OAuth)` chat, keep the SDK graph provider mapped to
  `openAI`, but attach the OpenAI OAuth override based on the original
  initialized agent endpoint/provider (`openai_oauth_responses`). If the
  override decision only checks the mapped SDK provider, the request falls back
  to the normal OpenAI client and fails without `OPENAI_API_KEY`.
- OpenAI OAuth native graph overrides must be real LangChain `Runnable`
  instances. Plain objects with `invoke()`/`stream()` fail when LibreChat pipes
  `AgentContext.systemRunnable`, and the override model must preserve that
  system context because LibreChat may invoke `overrideModel` directly after
  building the piped local model.
- After changing `packages/api` code used by the legacy `/api` backend, rebuild
  `@librechat/api` and restart the actual 3080 backend process before telling
  the user to retest `/c`. A green package test/build is not enough when the
  running `api/server/index.js` process still has the old module loaded in
  memory.
- OpenAI OAuth API calls have a 258K-token provider-side context ceiling before
  ChatGPT/OpenAI OAuth compression behavior can kick in. Native LibreChat token
  config and runtime context budgeting for `openai_oauth_responses` must not
  inherit the normal OpenAI `gpt-5.5` 1M+ model window.
- For Steel OCR and quote Markdown in native LibreChat, keep the existing chat
  layout but make table cells wide enough for ERP/OCR columns and rely on the
  message-level horizontal table scroller instead of squeezing text into narrow
  cells.
- When the user says database rules must align with `docs/rules`, compare
  canonical source refs/hashes against `steel.rules`, then use the existing
  `packages/api/scripts/sync-steel-rules.cjs` readback flow. Do not hand-edit
  individual rule rows.
- Superseded 2026-07-06: title generation for every provider, including OpenAI
  OAuth, must enter through shared `generateTitle()` using user message plus
  conversation id. The helper may choose the OAuth transport internally, but
  `AgentClient.titleConvo()` must not wait for a run or call a dedicated
  `generateOpenAIOAuthTitle()` path.
- Keep OpenAI OAuth transport/config/title/usage helper names free of the
  `Steel` prefix. Reserve `Steel` naming for quote/OCR/rules/runtime context,
  Markdown capture, auto-parse/save, and other steel-business modules. Existing
  `STEEL_OPENAI_*` env names may stay only as backwards-compatible fallbacks.
- Do not add `OPENAI_PROVIDER` to production env templates for OpenAI OAuth.
  LibreChat's frontend/provider selection owns the OAuth vs API-key distinction;
  production env should carry actual runtime values such as model defaults and
  `OPENAI_OAUTH_AUTH_FILE`.
- Production deployment env should use a real `.env.prod` file that remains
  ignored by git, with only root `.env.prod.example` tracked as the placeholder
  template.
- `ALLOW_REGISTRATION=false` should not be treated as blocking production admin
  bootstrap. Use LibreChat's trusted `create-user` script; in a clean MongoDB,
  the first registered user becomes `ADMIN`.
- When production deployment moves from a VPS/Lightsail host to Render, disable
  the host SSH redeploy workflow before pushing `master`. Render should own
  auto deploy from GitHub, use the generated `onrender.com` domain until a
  custom domain is added, and store uploads plus OpenAI OAuth `auth.json` on a
  writable Persistent Disk such as `/data`, not in the image or a read-only
  secret file.
- Render production setup docs must mirror the actual Render UI fields: leave
  Root Directory blank, set Docker Build Context Directory to `.`, Dockerfile
  Path to `Dockerfile.multi`, Docker Command to
  `sh /app/deploy/render/start.sh`, Health Check Path to `/health`, Pre-Deploy
  Command blank, and Auto-Deploy to On Commit. A 1 GB disk is acceptable for a
  low-cost smoke deployment, but the mount path must still be `/data`. Use
  Secret Files only as a temporary bootstrap copy source for `auth.json`; the
  final OAuth file must live on the writable disk.
- For low-cost Render Starter production, create LibreChat users from the local
  terminal with `.env.prod` loaded instead of running `create-user` through
  Render SSH. Use
  `DOTENV_CONFIG_PATH=.env.prod CONFIG_PATH=librechat.yaml node -r dotenv/config config/create-user.js ...`
  so the script connects to production MongoDB without pointing local config at
  `/data/librechat.yaml`, and never pass passwords as command arguments.
- Render auto-deploy only updates tracked code from `master`. Production
  runtime state must be documented as manual sync boundaries: paste `.env.prod`
  values into Render Environment, upload local `librechat.yaml` to
  `/data/librechat.yaml`, upload local `~/.codex/auth.json` to
  `/data/openai-oauth/auth.json`, configure SSH public keys in Render, and
  maintain MongoDB Atlas/Supabase state outside Render. Restart Render after
  replacing config or OAuth auth files.
- When Render Standard cost is rejected for production, switch the primary
  runbook to DigitalOcean Droplet instead of continuing Render-specific setup.
  Keep MongoDB Atlas and Supabase managed externally, use a user-owned domain
  such as `chat.<domain>`, run only the app plus Caddy on the Droplet, store
  production files under `/data` and `/etc/librechat`, and delay enabling a
  GitHub Actions SSH redeploy workflow until the Droplet, SSH key, and GitHub
  secrets exist.
- In the DigitalOcean Droplet compose stack, do not give the Caddy container
  the full app `.env.prod` file. Caddy only needs `LIBRECHAT_DOMAIN` and
  `PORT`; DB URLs, JWT secrets, OAuth paths, and app credentials should stay in
  the API container environment only.
- For the DigitalOcean production deploy workflow, prefer the job-scoped
  GitHub `GITHUB_TOKEN` for GHCR push and immediate remote pull before adding a
  long-lived `GHCR_READ_TOKEN`. Only introduce a PAT if package visibility or
  cross-repo ownership actually requires it.
- For Steel price lookup material simplification, only unify the query/tool
  input enum into simple material keywords such as `黑鐵`, `白鐵`, `錏`, `鋁`, and
  `鋅`. Keep import/storage canonical material values such as `No1 白鐵`,
  `BA 白鐵亮面`, `OT 黑鐵`, `錏/鍍鋅`, `鋁鋅`, and source cleanup behavior unchanged.
- Steel plate lookup must not relate `鐵板/鋼板` to `切工/切割` rows. Steel
  plate has no separate cutting price lookup; keep related `切工/切割` rows only
  for `鐵軌`/鋼軌, `H型鋼`, `工字鐵/I字鐵`, `角鐵/角鋼`, `槽鐵`, `平鐵/扁鐵`,
  `圓鐵/圓鋼`, `方鋼/方鐵`, `圓管/鋼管`, `方管`, and `扁方管`.
- For `search_price_candidates` with `category: "鐵板/鋼板"` and
  `material: "鋅"`, keep lookup broad because zinc-family plate data is sparse.
  Search by category plus material keyword only; do not also restrict by
  thickness or extra keyword terms.
- If Codex shell reports `node`/`npm` missing after the user upgrades Node,
  inspect `/Users/neven/.nvm/versions/node` and run verification with the
  current nvm bin path explicitly in `PATH`; do not assume the inherited shell
  PATH has already dropped the old Node version.
- Steel quote/native smoke fixtures must enforce the ERP `system_order` item
  numbering rule: material main items use 10, 20, 30, and attached processing
  rows use subitems such as 11, 12, 21, 22. Do not accept mock output with
  sequential 1, 2, 3 when verifying native context/rule sync.
- Mock E2E UI checks run against the production `client/dist` bundle served by
  the backend. After changing client code, run `npm run frontend` or
  `npm run e2e:prepare` before judging Playwright UI failures; a stale bundle
  can make frontend changes look broken even when backend SSE events are
  correct.
- When the user explicitly says Steel OCR should directly use PaddleOCR MCP and
  delete `run_file_ocr`, remove that name from AI-visible tools, executable
  Steel tool dispatch, runtime tool policy, and AI-facing rules. Keep
  assistant OCR Markdown auto-save and `read_markdown(scope: "ocr")` recovery
  as the durable database path.
- When rewriting Steel OCR rules after removing `run_file_ocr`, explicitly name
  PaddleOCR MCP OCR as the required parser for PDF/image text and table
  content. Do not replace it with vague provider vision or built-in OCR
  wording.
- Steel OCR rules that name PaddleOCR MCP are insufficient by themselves. Also
  register the PaddleOCR MCP server in `librechat.yaml` and ensure native Steel
  PDF/image turns inject the MCP server token before `loadToolDefinitions()`;
  otherwise the model falls back to provider file parsing and may report "No
  text could be parsed" without ever calling `paddleocr_vl`.
- PaddleOCR MCP can take longer on real drawing PDFs, but the current accepted
  default is 10 minutes (`600000` ms). Do not restore the old 20-minute
  (`1200000` ms) default unless the user explicitly asks for it.
- Portal-based Markdown table modals must explicitly sync the active root theme
  class and `data-theme`; do not assume a body-level portal inherits the chat
  message theme scope.
- Markdown table modal cell colors need intentional review styling: use subtle
  row/header/pinned-column color variables with light/dark variants instead of
  plain inherited surface colors.
- In Markdown table modals, selected sticky columns should not change cell
  color; preserve row zebra color and use only a subtle divider/shadow for the
  pinned state. Zebra row contrast should stay low.
- Markdown table modal controls must reuse LibreChat's existing selector
  components such as `ControlCombobox`; do not ship native `<select>` controls
  that visually diverge from Agent Builder and prompt category selectors.
- Markdown table modal comment controls should use LibreChat shared UI
  components first: `Button` for icon actions and `Input` for compact text
  entry. Saved comments should render as inline text in the cell instead of a
  hover popup; fade the original cell value when an inline comment is present.
- Markdown table modal comment icon buttons belong in the cell's top-right
  corner. Reserve right-side cell padding so the icon does not cover text, and
  align the single-line comment input from that same right edge.
- Markdown table modal comment inputs must be viewport-aware. Do not anchor the
  editor with plain cell-relative absolute positioning; use LibreChat's existing
  Radix/Ariakit popover positioning patterns with collision handling.
- After moving a Markdown table comment input into a Radix Popover, blur-save
  must also handle popover dismiss paths such as outside click/onOpenChange.
  Test the outside-click path directly, not only a synthetic input blur.
- Markdown table modal column selector belongs on the left side of the toolbar;
  keep copy/download/close actions grouped on the right.
- Markdown table modals should widen columns with long body text, such as
  `備註`, instead of forcing all columns into similar widths that make review
  text wrap too aggressively.
- Markdown table modals should support Escape to close, with the keydown
  listener attached only while the modal is open and removed on close.
- When compact workbook is the only supported Steel runtime mode, remove mode
  inputs and tool-registry branches instead of keeping no-op `contextMode`
  parameters that imply a hidden full-mode path.
- Steel OCR rules are a fixed `otherGlobalRules` subset from `steel.rules`.
  Do not add `includeOcrRules`, attachment/evidence runtime gates, or a separate
  OCR rule loading path; load `otherGlobalRules` once and classify OCR rules by
  `rule_sections`. Attachments should stay metadata/evidence only.
- For file-only Steel OCR title generation, pass the uploaded filename and a
  simple title rule into the OpenAI OAuth title prompt. Do not add hard
  `preferredTitle` override logic; let the AI generate the final title from the
  filename and rule.
- Markdown table modal comments are pending next-turn user text. After a
  successful fresh chat submit, drain and clear the pending comment queue so the
  chat-input helper/count disappears, the `localStorage` backup is removed, and
  the next turn starts with zero pending comments; the submitted user message
  itself should visibly include the appended comment list. In that appended
  list, group comments by message/Markdown, because one message can contain
  multiple Markdown tables and each rendered Markdown table is one Markdown
  unit. A single table cell has at most one pending comment; editing the same
  cell replaces that comment, and blanking the input removes it. End the
  appended list with an instruction for the AI to output a separate complete
  updated table for each affected Markdown. Use the AI message timestamp plus
  Markdown index as the visible group label; do not show role.
- Pending Markdown table comments helper text can stay a concise grouped count,
  but hover/focus must show the exact Markdown block that will be appended to
  the next user message. Reuse the shared append formatter for that preview.
- Pending Markdown table comments must be backed by conversation-scoped
  `localStorage` until successful fresh submit. Do not tie restore behavior to
  the mounted chat input only; refresh/back-forward should restore the queue.
- LibreChat leave warnings are global and always on for browser unload, close,
  refresh, and external site navigation, but same-site route navigation such as
  `/c` to `/c/:conversationId` must not prompt. Do not condition browser unload
  warnings on pending Markdown table comments.
- When the user asks to open LibreChat for browser testing, provide the
  frontend dev UI at `http://localhost:3090/`. Backend
  `http://localhost:3080/` may serve static production output, but it is not
  the expected Vite dev URL for local UI testing.
- If native Steel OCR still falls back to "No text could be parsed", do not
  only inspect PaddleOCR MCP startup. Also verify the active request populated
  `req.steelNativeContext.currentTurnFiles`; uploaded PDFs may arrive as
  `application/octet-stream`, so filename extension fallback must keep them
  OCR-capable for PaddleOCR MCP injection.
- OCR output rules must forbid approximate drawing data. Dimensions, thickness,
  quantities, holes, diameters, and weights must be exact from OCR/source
  evidence; if unclear, output `未確認` or candidate values with low confidence,
  not `約`/`大約` values.
- For native Steel OCR, condition PaddleOCR MCP exposure on the current request
  carrying OCR-capable files, not on AI pre-judgment. Check
  `req.steelNativeContext.currentTurnFiles`, request attachments, body files,
  and body attachments with filename-extension fallback for
  `application/octet-stream`; do not inject PaddleOCR MCP on turns with no
  PDF/image evidence unless the user explicitly asks for always-on loading.
- PaddleOCR MCP is now intentionally eager for no request-time cold start.
  Preserve `startup:true` in the tracked MCP initialization path; do not force
  `PaddleOCR` back to `startup:false` before `createMCPManager()`.
- PaddleOCR preflight retry matching must stay narrow. Add connection startup
  phrases such as `connection timeout after` and `failed to establish
  connection`, but do not add generic `timeout` / `timed out` patterns that
  would blindly rerun a real long OCR job timeout.
- MCP server names may contain config-valid characters that provider tool names
  reject. Keep raw server names for MCP registry/config lookup, but sanitize the
  provider-facing MCP tool-name suffix to `^[a-zA-Z0-9_-]+$`; names such as
  `PaddleOCR-VL-1.6` must not be sent to OpenAI as-is.
- Production LibreChat MCP runtime config comes from host-managed
  `/data/librechat.yaml` through `CONFIG_PATH`, not repo `.mcp.json`. Treat
  `.mcp.json` as local Codex/MCP client config unless a task explicitly targets
  local MCP tooling.
- PaddleOCR has nested timeouts: LibreChat MCP `timeout` controls tool
  execution from LibreChat's side, while `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT`
  and `PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT` control AI Studio calls inside
  `paddleocr-mcp`. The current default is `timeout: 600000`,
  `PADDLEOCR_MCP_AISTUDIO_REQUEST_TIMEOUT: "60"`, and
  `PADDLEOCR_MCP_AISTUDIO_POLL_TIMEOUT: "600"`. Keep request/connect timeouts
  shorter than the OCR job budget so startup/request failures surface quickly.
- The current PaddleOCR MCP server key should be `PaddleOCR`; keep
  `PADDLEOCR_MCP_MODEL=PaddleOCR-VL-1.6` as the model setting. Do not reuse the
  model name as the LibreChat MCP server key.
- For PaddleOCR with `PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio"`, do not prepare
  a host-mounted PaddleOCR Python environment at API startup. The production
  image build installs Python 3.12 and `paddleocr-mcp` with `uv tool install`
  before deploy/start, and LibreChat launches the eager MCP server with
  `command: paddleocr_mcp`, `args: []`, and `initTimeout: 60000`. The API image
  still needs `uv`/`uvx` for build-time install support, but runtime startup
  must not depend on `uvx --from paddleocr-mcp` package resolution.
- Do not keep PaddleOCR source/provider branching when there is only one
  supported OCR API path. Production should require
  `PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN`, model, and timeout settings only; do
  not expose a PPOCR source selector through user-editable `.env`. Hardcode
  `PADDLEOCR_MCP_PPOCR_SOURCE: "aistudio"` in the MCP env map and smoke
  transport env, instead of setting provider through CLI args or making it a
  separate operator config knob.
- PaddleOCR smoke must launch MCP from the same `librechat.yaml` server config
  used by LibreChat, including `command`, `args`, `env`, timeout, and token
  interpolation. Do not duplicate PaddleOCR MCP env assembly inside the smoke
  script; read `CONFIG_PATH` / `/data/librechat.yaml` and resolve
  `${PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN}` from the container env.
- Keep PaddleOCR smoke and resolver handling format-neutral. PaddleOCR supports
  PDF and image inputs such as PNG, JPG/JPEG, BMP, and CIF, so generic OCR code
  must not assume only PDF/PNG/JPG or bake a fixture-specific marker set.
- PaddleOCR API usage limits should be reflected in docs and operator guidance:
  after a model reaches its daily parsing limit, exceeded requests return `429`;
  there is no documented single-file size limit, but keep PDF inputs within 100
  pages to avoid timeout, and expect pages beyond the limit to be ignored.
- Do not expose `PADDLEOCR_UV_PYTHON_INSTALL_DIR` or reinstall toggles for the
  current AI Studio PaddleOCR path. Those controls only made sense for the old
  host-prepared Python environment approach; the current contract is a single
  `uvx` command in LibreChat MCP config plus the AI Studio token and timeouts.
- Do not bake a specific ignored drawing fixture, path, or expected marker set
  into generic PaddleOCR smoke code. The smoke script should only run live OCR
  when the caller passes a freshly obtained S3 smoke PDF URL as the command
  argument, and it should only check fixture markers when the caller provides
  `PADDLEOCR_SMOKE_EXPECT_MARKERS`. Do not make GitHub Actions production deploy
  gate on live PaddleOCR OCR; AI Studio API/network failures should not block
  LibreChat app rollout. Keep PaddleOCR smoke as a manual diagnostic.
- Do not assume AI Studio website OCR speed matches `paddleocr-mcp` AI Studio
  API behavior. On production, a simple tracked PDF completed through
  `paddleocr_vl` in about 214 seconds, while a larger drawing PDF returned
  `Error calling tool 'paddleocr_vl'` with aiohttp `ClientOSError: [Errno 32]
  Broken pipe` after several minutes.
- When production PaddleOCR fails from a VPS, distinguish upload from provider
  download. For `file_path` inputs, `paddleocr-mcp` multipart-uploads the file
  from the host to `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`; the
  provider is not downloading a URL. On DigitalOcean SGP1, a larger drawing PDF
  upload timed out before any OCR job id was returned.
- `fileUrl` is not automatically a fix for AI Studio from DigitalOcean SGP1.
  AI Studio can connect back to a Droplet-hosted file, but larger downloads can
  still return `HTTP 408 Request Timeout` and make the temporary file server log
  `BrokenPipeError`; use this as evidence for provider-side download/path
  instability before investing in file-url integration.
- S3 presigned URLs must be validated with a signed `GET`, not only `HEAD`;
  `GET` with `Range: bytes=0-0` should return `206 Partial Content`. Even a
  valid S3 `fileUrl` in `ap-southeast-2` did not make AI Studio accept a larger
  drawing PDF; the AI Studio submit request still timed out before returning a
  job id.
- For official AWS S3 production storage, do not add explicit path-style env in
  production examples or runbooks. Leave generic S3-compatible storage support
  in code, but keep AWS S3 Hong Kong config to region, bucket, credentials,
  optional endpoint, and `S3_URL_EXPIRY_SECONDS`.
- Do not reduce the AI Studio production issue to only large drawing PDFs.
  From DigitalOcean SGP1, a 296,377 byte `docs/reference/example/b.png`
  uploaded via multipart still timed out during write, and the same PNG through
  a valid S3 presigned `fileUrl` returned AI Studio `HTTP 400` code `10000`
  with `文件 URL 访问超时` when stored in AWS S3 Sydney `ap-southeast-2`.
- AWS S3 Hong Kong `ap-east-1` is the first confirmed working external
  `fileUrl` path for AI Studio from production: the same 296,377 byte
  `docs/reference/example/b.png` returned an AI Studio job id in about 15
  seconds, reached `done`, and produced a downloadable JSON result with a table
  block.
- Do not assume AWS S3 Hong Kong `ap-east-1` solves large files. The 7.6 MB
  drawing PDF tested from production was readable from the container via signed
  range GET, but AI Studio `fileUrl` submit returned `HTTP 408 Request Timeout`
  after about 70 seconds with no job id. Test smaller submit units before
  changing app architecture: compressed PDF, rasterized image, or split
  pages/images.
- Smaller PDFs can succeed through AWS S3 Hong Kong `ap-east-1` and AI Studio
  `fileUrl`: a 454,807 byte `d.pdf` returned a job id in about 19 seconds,
  reached `done`, and produced a 73 KB JSON OCR result with parsed table/text
  blocks. Treat file reduction as the first production design path before
  self-hosting OCR.
- LibreChat S3 file storage is a configuration switch, not the same as direct
  PaddleOCR `fileUrl` OCR. Setting production `fileStrategy: "s3"` plus
  `AWS_REGION=ap-east-1` stores new uploads in S3, but Steel OCR still resolves
  files to bytes unless the runtime is explicitly changed to pass S3 presigned
  URLs to PaddleOCR.
- PaddleOCR MCP tool calls must not rely on model-supplied relative filenames.
  Before calling `paddleocr_vl`, resolve filename-only
  `input_data` from the permission-checked current-turn LibreChat attachment
  records into a MCP-readable absolute/data input.
- PaddleOCR MCP tool calls must not trust provider sandbox paths such as
  `/mnt/data/<filename>` as API-container paths. Match path-shaped and
  URL-shaped `input_data` against permission-checked current-turn attachments
  first, then use the storage strategy so S3 files become backend-generated
  presigned URLs.
- AWS Console and presigned URLs percent-encode unicode object keys. This is
  normal URL encoding, not an S3 rename. When deriving an S3 key from a URL for
  `GetObject`, decode the URL path once; do not decode already-stored
  `storageKey` values.
- If the user confirms an S3 object exists but production logs show
  `NoSuchKey`, compare the exact logged key against the object key before
  blaming storage. A logged `%E...` key next to a Chinese filename usually
  means the server is using a URL-encoded path as the object key.
- When diagnosing PaddleOCR S3 `fileUrl` failures, smoke the exact URL shape
  generated by LibreChat's storage strategy, not only a hand-written clean
  presigned URL. AI Studio accepted the same private S3 object with a clean
  presigned URL but rejected a URL carrying response header overrides for the
  Chinese filename with `文件 URL 无法识别`; PaddleOCR handoff should use a clean
  signed S3 URL without `customFilename`/`contentType` overrides.
- When PaddleOCR MCP receives an invalid `input_data` shape such as a LibreChat
  `file_id`, fix the backend argument resolver instead of changing OCR rules,
  unless the user explicitly asks to revise rules.
- When the user scopes PaddleOCR upload constraints to frontend UI only, do not
  add backend validators, LibreChat YAML limits, or PDF page-count checks. Keep
  the change to file input affordances and client-side preflight validation.
- For Steel price lookup/import, `tierPrices` / `unit_price_a-b-c-f` are the
  only tier price fields. Do not add `tierRatios`, `ratio_a-b-c-f`, parser
  fields `ratioA-F`, or `比率A-F` schema mappings; source `比率A-F` columns are
  intentionally ignored rather than stored or exposed.
- `OCR 結果確認表` is OCR persistence, not workbook/quote state. Verify it via
  `steel_working_order_memory.memoryKind = ocr_extract`; only expect
  `working_order_row`, `steel_workbooks`, or workbook patches after the flow
  intentionally creates quote/workbook rows.
- OCR review turns may include extra tables for user confirmation, but those
  helper tables are not workbook state. Only save `ocr_extract` for OCR tables
  and only save workbook keys for intentionally emitted quote/workbook tables
  such as `system_order`; skip unclassified confirmation tables instead of
  storing them as `calculation_fact`.
- Assistant Markdown table auto-save is title-gated: save only OCR result
  tables whose nearby title contains `OCR`/`ocr`, and only workbook rows whose
  nearby title contains `system`. Keep using table structure as a second check,
  but do not save assistant Markdown tables from headers alone.
- S3 image uploads already have a dedicated Sharp preprocessing seam in
  `packages/api/src/storage/images.ts`: uploaded images are resized/compressed
  and saved as JPEG with `contentType: image/jpeg`. Keep generic S3 CRUD
  changes format-neutral, and do not duplicate image conversion logic in
  `packages/api/src/storage/s3/crud.ts`.
- Steel activity UI should not show successful `parse_status: saved` rows such
  as `Steel form parsed`; those are internal parse status, not user-facing work
  results. Show the `Total` aggregate and actual save/preflight rows instead;
  keep partial/skipped parse status visible because they need user attention.
- Resumable assistant-message elapsed timers must be anchored to the
  server-side generation job `createdAt` value. Do not let a reconnecting
  browser rebuild resumed user/assistant placeholders with `new Date()` or
  `Date.now()`, or the visible running time will restart from zero after
  cross-device resume.
- When the user says not to commit after a bug fix, keep the working tree
  uncommitted and report the dirty files/status in the wrap-up. Do not stage,
  commit, or push unless they explicitly ask afterward.
- OCR preprocessing chunk work must be durable and idempotent per file key and
  chunk identity. Save organized chunk Markdown immediately after each
  subagent pass, and on resubmit resume from persisted `paddleocr_preflight` and
  `ocr_extract` state instead of rerunning OCR, organizer subagents, or
  parse/save for completed chunks.
- OCR preprocessing must merge same-file-key chunk Markdown into one source
  Markdown string before adding OCR content to main-agent
  `additional_instructions`; per-chunk Markdown rows are durable intermediate
  state, not main-agent context.
- OCR rule version is part of OCR organizer output validity. If the OCR rule
  version/hash changes, reuse raw `paddleocr_preflight` chunks but rerun every
  subagent organizer chunk and rebuild the final merged OCR Markdown before
  starting the main Steel agent.
- OCR preprocessing must not rasterize PDFs into PNG/JPEG chunks. Split PDFs by
  page range into PDF chunks, such as pages 1-50 and 51-100, so PaddleOCR can
  still see embedded PDF text/vector content.
- OCR preprocessing merged Markdown must tolerate different headers across
  chunks. Union headers in first-seen order, keep all rows, and leave missing
  cells blank instead of inferring values.
- OpenAI OAuth organizer smokes should not assume OAuth is unavailable just
  because dev `.env` does not set `OPENAI_OAUTH_AUTH_FILE`. On this machine,
  the default npm/OpenAI OAuth token path may be valid; use the default resolver
  unless the user explicitly asks to override it.
- OCR preprocessing organizer/subagent failures and PaddleOCR provider failures
  must surface as chat request errors, not only as partial activity state. Emit a
  UI-visible redacted activity error, then throw a redacted error so the chat
  message shows the concrete failure.
- Direct AI calls to the PaddleOCR MCP tool must follow the same raw-to-Markdown
  contract as automatic preflight. Store raw output as `paddleocr_preflight`,
  organize it into `ocr_extract` chunk Markdown, and return only merged
  `<file_key>` OCR Markdown to the agent context.
- OCR preprocessing has two durable resume nodes: PaddleOCR/preflight raw data
  and organizer/subagent Markdown. After all PaddleOCR chunks finish, re-read
  preflight state from DB for organizer input; after organizer chunks save,
  re-read Markdown state from DB for runtime merge.
- For PDFs under the 50-page chunk size, skip only the PDF splitting/uploading
  step. Still create a single `1/1` chunk identity and run the same
  PaddleOCR -> organizer/subagent Markdown -> returned merged Markdown flow.
- OCR preprocessing progress is only useful if the frontend keeps every event.
  Add new Steel activity sources to the SSE allow-list, include `message` in
  the dedupe key, preserve `errorMessage`/`failedKeys`, and render
  `ocr_preprocessing` labels verbatim instead of mapping them to generic
  PaddleOCR text.
- Stop/preflight cleanup must treat a generated UUID/stream id as a real
  conversation id even before the backend `created` event arrives. Once the
  optimistic user message is hydrated under that id, abort/404/error cleanup
  must not remove the sidebar row or navigate back to `/c/new`; preserve the
  user message, persist it from the abort endpoint when needed, and only clean
  true `new`/`pending` placeholders.
- Duplicate-tab during preflight exposes backend persistence windows. Once the
  frontend can show `/c/<generated-id>`, the backend must already have upserted
  a conversation shell and resume metadata for that id, and immediate title
  generation should update that DB-backed shell rather than wait for the main
  response to finish.
- Automatic preflight artifacts are conversation-id bound data. After send
  message generates the real conversation id and before preflight writes any
  `paddleocr_preflight` / `ocr_extract` rows, the conversations collection must
  already contain the corresponding row so every later title, preflight, and
  message write has the same durable parent.
- Do not conflate aborting in-flight title generation with discarding an
  already-generated title. For generated conversation ids with a DB shell,
  preflight/send-message failure may abort the title model call, but only a
  superseded/replaced stream should abort the discard signal and prevent
  `saveConvo({ title })`.
- Preflight abort persistence must seed a complete displayable user message in
  `GenerationJobManager` metadata before client initialization finishes. Include
  uploaded file metadata such as `file_id`, `filename`, `filepath`, `type`, and
  `bytes`, while excluding raw file text/OCR content, so refresh after Stop
  still renders the original PDF chip.
- OCR PDF chunk artifact reuse requires both a DB row and a successful S3
  existence check for that row's storage key. Only then show `Fetched pdf
  chunks`; if the S3 object is missing, regenerate and upload the chunk PDF and
  keep the progress event on the uploaded path.
- OCR preprocessing must use one unified PaddleOCR flow for PDF chunks,
  under-50-page PDFs, images, and whole-file inputs. Treat image/whole-file
  inputs as a single `1/1` chunk and run raw PaddleOCR -> organizer/subagent
  Markdown -> official OCR Markdown; do not keep a separate generic
  PaddleOCR event or generic raw-save path.
- Official OCR Markdown is the only `read_markdown(scope: "ocr")` data.
  Subagent chunk Markdown and PaddleOCR raw rows are resume/progress state only,
  and AI-agent OCR Markdown must not be promoted to official PaddleOCR OCR
  Markdown unless it came through the PaddleOCR preprocessing pipeline.
- Official OCR Markdown needs an OCR source distinction. PaddleOCR-derived
  official rows may skip future PaddleOCR preflight for the same file key, but
  AI OCR-derived official rows must remain readable OCR Markdown only and must
  not satisfy the PaddleOCR preflight skip check.
- Multi-file official OCR Markdown should not be a single replace-all
  `default` bucket. Store each multi-file OCR result as its own active row with
  `ocrFileKey: "default"`, `ocrFileKeys`, and a stable `ocrGroupKey` derived
  from the covered file key set, so later OCR for a different file set does not
  overwrite completed OCR Markdown.
- Multi-file OCR turns must be batched by message phase, not run as independent
  full per-file pipelines. First build every file/chunk identity, then run
  PaddleOCR for all missing chunks, then organizer/subagent Markdown for all
  missing chunks, then pass merged per-file OCR Markdown attachments to the
  main agent together.
- When the main agent returns multiple PaddleOCR-derived official OCR Markdown
  tables that each match a file key or filename, save each official Markdown
  under that matched file key. Use the `default` multi-file grouping only for
  genuinely integrated OCR Markdown that cannot be attributed to one file.
- OCR preprocessing resume tests must prove file-key isolation, not just
  generic retry. Cover multi-file partial progress where one file resumes from
  saved PaddleOCR raw data while another file still runs PaddleOCR, and verify
  DB reads are scoped by both `ocrFileKey` and `sourcePdfKey`.
- Organized subagent chunk Markdown is progress/resume state. Its save counters
  should stay `ocr_preprocessing_chunk_markdown`; do not count it as official
  `ocr_markdown`/OCR table output until the main agent returns official OCR
  Markdown.
- OCR preprocessing chunk size must have one config source. Use
  `STEEL_OCR_PREPROCESSING_CHUNK_SIZE_PAGES` with fallback `50` through the
  shared OCR config helper, and pass the resolved value into ToolService chunk
  planning instead of scattering literal `50` values in runtime code.
- When simplifying OCR preprocessing tests, remove old single-file pipeline
  compatibility adapters. ToolService tests should mock the current batch
  contract (`files: [...]` -> `{ files: [...] }`) so test fixtures do not hide
  production shape drift.
- For large-PDF OCR preprocessing, check existing official OCR Markdown and
  complete organized chunk state before downloading/counting the PDF. Resume
  state can skip expensive file IO when the batch pipeline only needs to emit
  merged Markdown events.
- OCR preprocessing progress should treat `Running ...` rows as live status.
  When the matching `Ran ...` event arrives for the same file/chunk/stage,
  replace the running row in activity state instead of keeping both.
- Open Responses final assistant capture must read the normalized LibreChat
  `{ type: "text", text }` output shape as well as spec-level `output_text`;
  otherwise the chat can show assistant content while Steel Markdown capture
  sees blank content and skips parse/save.
- Final OCR Markdown is official OCR Markdown. Do not header-gate it: table
  headers are AI-generated and not a stable detector. Save every final OCR
  Markdown table, bind only an explicit `file:...` key in the table title to
  that file key, and use `default` when the title has no file key.
- Title generation must not wait for Steel OCR preflight, tool loading, agent
  run initialization, or assistant response content. For all providers, build
  the title from the user message plus conversation id and keep OCR/file title
  filename guidance in the prompt instead of a separate OpenAI OAuth title path
  or hard `preferredTitle` override.
- Do not split or pace a provider's large text delta in LibreChat just to make
  the UI look streamed. Preserve provider delta granularity exactly; if a turn
  appears all at once, verify whether the provider `doStream` source emitted one
  large delta or real incremental deltas before changing SSE/UI behavior.
- Browser-side SSE diagnostics should not depend only on the app logger or
  devtools log capture path. For streaming investigations, temporary raw
  `console.debug` counters can prove receive/apply/buffer/drop behavior in the
  active page; remove that instrumentation after the root cause is verified.
- When OCR streaming diagnostics show frontend `Content type mismatch`, do not
  stop at delta counters. Verify the target content index against synced
  tool-call parts; a text delta can be received/applied telemetry-wise while
  still being dropped by the content-type guard.
- OCR preprocessing Markdown passed to the main Steel agent is source context,
  not final official OCR Markdown. Merge same-file-key chunks/tables for the
  attachment, but put the canonical `OCR 結果確認表：filename（file:key）` title
  requirement on the main agent's final OCR output and save path.
- Final OCR Markdown capture is title-local. If a table's own title contains
  `OCR`, save that table as official OCR Markdown; do not promote later
  non-OCR helper/manual-review tables in the same response just because an
  earlier OCR table existed.
- Steel activity/event messages should start with the action verb. Prefer
  `Saved Working Order Memory`, `Saved Markdown parse`, and `Saved PaddleOCR
  preflight` over noun-first `... saved` wording.
- Before automatic Steel OCR preflight or client initialization starts, persist
  the submitted user message to the `messages` collection, not only to
  `GenerationJobManager` metadata. Preflight/organizer failures can happen
  before `AgentClient.onStart` reaches the normal user-message save, and the
  durable conversation must still reload with the user's text and file chips.
- For long OCR preflight resumable turns, keep the preliminary user message id,
  the `created` SSE user message, and the main `AgentClient` user message as
  the same id. Also send the actual response id on `created`; otherwise the UI
  depends on a later `on_run_step` to reconcile the assistant placeholder after
  several minutes of OCR-only events.
- When restarting the local backend from Codex, do not rely on a plain shell
  background command such as `... &` or `nohup ... &`; the runner can tear it
  down after the command exits. Use a persistent process manager such as
  `screen` or keep an explicit foreground exec session, then verify
  `http://localhost:3080/health` before telling the user it is running.
- Admin-only token actions need visible pending/success/failure feedback even
  when the underlying token expiry does not change. Do not rely on a refreshed
  timestamp as the only proof that a button click did something.
- OAuth token status UI should use fixed label/value rows such as `Status`,
  `Expires`, and `Codex CLI`; avoid mixing token state into inline explanatory
  text that makes the section harder to scan.
- OAuth token refresh feedback belongs in the existing `Status` row when that
  row is already the user's status focal point; avoid adding a second status
  line below the actions.
- For server-side Codex CLI availability in LibreChat production, install and
  verify the actual `@openai/codex` CLI binary used by the API runtime. Do not
  confuse it with `@openai/codex-sdk`, and do not assume a host-level install
  is visible inside the Docker API container.
- Localhost Codex CLI detection runs inside the backend process, not the user's
  interactive shell. If `codex --version` works in shell but UI says
  unavailable, first check backend PATH/restart state and probe common absolute
  install paths such as `/opt/homebrew/bin/codex` before blaming the UI.
- Codex CLI device-login output prints the prompt text and the actual one-time
  code on separate lines, and the code can be `4-5` characters such as
  `ABCD-12345`. Parse the full captured output near the code prompt instead of
  only scanning the prompt line or assuming `4-4`.
- Codex login UI should keep device-auth state in a LibreChat-style modal
  instead of an auto-opened `about:blank` popup. Show login status, verification
  code, login URL, and copy feedback in the modal; let the user open the
  verification link explicitly after copying the code.
- Codex login UI state must live outside the model-list menu/submenu layer.
  Keep the pending session id, polling hook, and dialog state in a provider that
  remains mounted when the model list closes.
- When starting a new Codex login from an overlay that may have restored a stale
  session, keep the restored session in the modal instead of starting a second
  server session. If a true restart is needed, clear the old stored session
  before creating the new one.
- Popup-based Codex login retries are fragile in overlay UIs. If the UI can be
  closed and remounted, persist the login session id, restore polling, and
  reopen the same modal rather than depending on a browser tab that may close or
  lose state.
- Local LibreChat OAuth auth files should use an app-specific path such as
  `$HOME/.librechat-openai-oauth/auth.json` when testing localhost, so server
  login does not overwrite or share the user's personal `~/.codex/auth.json`.
- Codex OAuth status rows should use compact status labels plus a colored dot:
  pending/loading yellow, success green, and failed/unavailable/expired red.
  Avoid verbose labels such as `Login pending`, `Login starting`, or
  `Login failed` in the status value itself.
- Usage remaining unavailable states should also use the red status dot, not
  bare `Unavailable: reason` text.
- When disabling Codex login `Open link` until the code is copied, show a short
  inline hint in the link step explaining that the user must copy the
  verification code first, then switch the hint to tell the user to open the
  page and complete login verification after copy succeeds.
- For Steel Supabase rollouts, treat local `.env` as dev and `.env.prod` as
  production when both are present. Apply and verify dev first; never copy to
  production until the user explicitly approves the verified dev result.
- OCR preprocessing and the main OpenAI OAuth agent must both honor an
  explicitly selected model such as `gpt-5.6-luna`. If Codex reports that the
  model needs a newer client, update the OAuth transport so it resolves current
  model metadata and protocol flags; do not silently fall back to an older
  organizer model.
- Migrating Codex OAuth login to app-server JSON-RPC must preserve the existing
  Admin device-code modal UX: show and copy the verification code first, then
  enable the explicit Open URL action. Replace only the backend prose parser;
  browser login is an additional option, not a replacement for device login.
- 新版 Steel 產品價格 workbook 更新時，以 `erp_item_code` 作唯一鍵直接覆蓋既有價格列；不得因 category/subcategory 看似異常而自行猜測、搬類或修改來源資料。workbook 原值與使用者明示 rename 才是更新依據。
- 新版 Steel 產品價格匯入順序固定為：先依新版 workbook category/subcategory 整理並驗證程式 enum 與 DB constraint，再執行資料匯入；不得先匯入後補 enum。
- Production Steel schema migrations 與 prod admin link 使用 `.env.prod.admin` 的 `PROD_ADMIN_URL` owner/admin 連線；production 價格與 rules runtime 同步使用 `.env.prod` 的 `STEEL_POSTGRES_URL` (`prod_app`)。不得用 `prod_app` 嘗試 `ALTER TABLE`，也不得因 repo Supabase link/MCP 指向不同 project 而誤套 migration。
- 長條型鋼材的共用切工規則涵蓋管類、圓條、型鋼等多種長條料時，檔名應使用 `長條料-切工.txt`，不要以 `長管` 誤縮小適用範圍；改名時同步更新 rule metadata、測試排除清單與舊 source-ref cleanup。
- `ratio_only` 表示比例欄本身就是報價單價；來源列即使標成 `unit: 支`，也要由通用 backend 正規化為有效 `Kg` tier price，輸出、quote unit 與材料計價模式都不得再按支處理。
- 長條料預設長度與括號／單重語意要分開判斷：平鐵、角鐵、圓管、圓條、扁方管、方管只要 `product_name` 沒有標記長度，就固定以 6M 為預設；即使圓管括號是外徑、方管重量欄有尺度問題，也不影響這六類的 6M 長度預設。
- 價格 workbook 的禁用品名標記必須由 importer code 統一處理：`沒做`、`勿用`、`沒出`、`沒貨`、`不生產`、`不用`、`沒現貨` 任一命中就強制 `value_state: no_price`，並清空 direct/ratio 價格，不能只依賴來源 value_state。
- 圓管品名的規格尾端純數字括號依使用者確認是6M整支 kg 單重，例如 `鍍鋅B管 3/8*2.3(17)` 的17是6M約17kg，不是外徑；parser 應保留 nominal pipe size、壁厚與6M單重三種語意。
- 無長度固定6M的長條類只包含平鐵、角鐵、圓管、圓條、扁方管、方管；方鐵不在此清單。
- 圓管括號不能用單一全類別語意：使用者已確認 `鍍鋅B管 3/8*2.3(17)` 的 `(17)` 是6M整支重量；配管等其他 family 的括號可能是外徑。parser 必須依 product family 判斷，不能因幾何理論重不符就覆蓋明示來源語意。
- 方鐵不屬於「品名無長度固定補6M」清單；只解析 product_name 明確提供的 M/L 長度，沒有長度時保持 null。
- 方鐵不屬於長條料類別；query、長度、單重與計價規則集中於 `docs/rules/類別規則/方鐵.txt`，不得再放入或套用 `長條料-切工.txt` 通則。
- 方鐵query不得固定unit=Kg，因Kg與支都有可用價格；首查不加unit filter。Kg row以邊長mm平方 × 成品長度mm × candidate density(g/cm³) ÷ 1,000,000計重，支row依明示整支長度配料並按整支direct價；規則只描述計算方式，不類比其他類別。
- 方管屬於「品名無長度固定補6M」的長條料類別；product_name 明示 M/L 長度時優先，未標長度時一律使用6M。連料、雨棚架、沖孔窗、太陽片等成品尺寸另行解析，不得覆蓋一般方管素材的6M預設語意。
- Steel 價格品名的禁用標記也包含「無生產」；需與「不生產」同樣由 importer 強制改為 `value_state: no_price` 並清空 direct/ratio 價格。
- 預設6M的長條材料查價不要固定加入 `stockLengthMm: [6000]`；AI應從返回的6000、12000或其他可用素材長度做不切清配料，訂單成品長度只用於裁切計算，不作母材長度 query filter。
- 品名中的「熱浸鍍」不得跨 category 一律改材質；只有平鐵、角鐵、圓管、圓條、
  扁方管、方管、槽鐵等明確材料 category 才可正規化為 storage enum `錏/鍍鋅`。
  五金/配件等用途描述（例如底漆標示熱浸鍍鋅用）不可據此推導材質。
- 價格 workbook 面積 unit 的 canonical 值是 `㎡`；normalization 方向固定為
  `m2/M2/平方公尺 -> ㎡`，不得反向改成 `m2`。
- 價格 workbook 的 category 在使用者確認前是受保護欄位；category classifier 的
  mismatch 只能輸出待確認清單，不能自動覆寫。驗證版必須寫成獨立新 workbook，
  並以來源 hash 與 protected-field diff 證明沒有碰到原檔。
- 只看 product_name 分 category 時，先辨識商品主體與 domain family，再看加工、用途、
  材質關鍵字。`PC板切`、`OT板雷射切割` 是板材商品，`鑽孔機` 是設備，`浪板用鋸片`
  是五金，`添誠格板` 的添誠只是品牌；不得讓「切、鑽孔、浪板、添誠」等片段搶走
  明確商品主體。真正不確定的衝突才進待確認清單。
- 使用者說「AX」時可能指 `erp_item_code` 以 `AX` 開頭的完整產品族，不是 ERP code
  正好等於 `AX` 的單筆 placeholder。必須先確認代號語意並掃描全部 prefix rows；AX family
  的 subcategory 仍依 `category + product_name` 規劃，不能以 `AX` prefix 直接指定。
- `黑鐵板剪床切倒角` 的「倒角」不是開槽；category 應為 `加工/切工`、subcategory
  應為 `倒角`。`product_name=倒角加工` 也遵循同一契約；分類規則不得因看到「倒角」
  就歸到 `加工/開槽`。
- 加工 taxonomy 最新契約把「倒角」提升為獨立 category `加工/倒角`，不再放在
  `加工/切工`；`黑鐵板剪床切倒角` 與 `倒角加工` 都必須跟著改。這條取代前一版
  `加工/切工 / 倒角` 契約。分類加工品時先判斷加工語意（切、孔、倒角、開槽、折、焊），
  再判斷形狀或機台，不可讓機台詞把主要加工類型蓋掉。
- Steel 報價分類先判斷被報價的完整商品主體，再判斷加工動作。`鎖孔|把手孔|天地串孔`
  屬 `門窗/門板`、`萬向接頭` 屬 `五金/配件`，subcategory 才標 `加工/孔`；但
  `鐵板魚眼孔` 的主體明確是鋼材鐵板，所以維持 category `加工/孔`。不可因使用者把
  多個詞列在同一句就整批套用；若清單與商品主體語意衝突，先指出並確認，不要直接認同。
- 加工孔類的 canonical category 名稱目前保留 `加工/孔`；使用者描述「孔加工」是階層
  語意，不應在未確認 exact rename 時自行改成 `加工/孔加工`。
- `processing_method`、`processing_shape` 是 parser 衍生 metadata，但搜尋介面不新增專用
  query params；把非空 canonical 值加入 `normalized_spec_text`，沿用既有 keyword 搜尋。
  不得因資料庫有結構化欄位就自動擴張 tool API。
- `型鋼結筒加工費` 的報價主體是 C型鋼加工服務，category 為 `加工/其他`、subcategory
  為 `C型鋼`；不能只因品名有型鋼就留在材料 category `C型鋼`。
- `修改門板工資`、`組合工資` 已確認為加工服務，category `加工/其他`、subcategory
  `其他`；不能因前者提到門板就留在捲門商品類，也不能因後者語意泛化就留在 `其他`。
- 尺、inch、mm 長度的原始表示要保留在品名／備註；正規化成毫米供比對時使用四捨五入整數，不以小數位作匹配條件。台制尺換算採1尺=303mm。
- 網類 `unit: 丸` 是整捲計價；不足一捲仍按一整丸，除非未來有明確裁售價格列，不得按使用長度比例拆價。
- 網類 `unit: 才` 的面積數量必須無條件進位成整才後再乘direct單價，不可用小數才計價。
- 網類首查只用 `category + subcategory + material`，不得用unit、尺寸keyword或長度filter。訂單unit只供候選返回後的計價判斷；AI從候選的整片、整捲或面積規格判斷是否足夠裁切。除了㎡可按實際小數面積外，其餘計價單位進位成整數並維持不切清。
- 網類品名單獨標示「2尺」通常是網子的高度／寬度，不是整捲長度；parser應寫入sheetWidthMm（2尺=606mm），不得寫成lengthMm。
- 網類不需要新增額外query params，也不把線徑、孔徑、尺/kg或其他尺寸塞進keyword；首查維持category/subcategory/material，完整網規格由parser放入既有candidate structured fields與dimensionSignature供AI挑選。
- 網類query未指定limit時維持通用預設30，不得由code自動放大為100；也不得用unit filter縮小候選。
- 網類規則集中維護於 `docs/rules/類別規則/網.txt`；查價總表保留類別摘要，專屬文件保存完整parser與整數單位計價契約，兩者不可互相矛盾。
- 點焊鋼絲網品名如 `5.5 15x15 2Mx3M(6)`：5.5是鋼絲直徑mm，15x15是cm網孔（正規化150x150mm），2Mx3M是每片尺寸，尾端(6)是每捆/束6片包裝數，不是kg或單重。
- 點焊鋼絲網線徑可能寫成 `6.0足`；此處「足」是線徑標示的一部分，parser仍應取得6.0mm，不得因此退回污染的normalized欄位。
- ST網的4尺/2尺是網寬、100尺是網長，16目是每英吋網孔數；尺原文保留並分別正規化到sheetWidthMm/sheetLengthMm，不得把16目當長度或厚度。
- 錏浪型網如 `8#(3.6)x38mm □孔`：8#是線號、3.6mm是線徑、38mm是38x38正方孔；parser以thickness=3.6、width/height=38保存，不得採污染的inch衍生值。
- 方鐵的 query、Kg 密度計重、素材長度來源與「品名未標長度時不補6M」維持在 `方鐵.txt`；但採 direct `支`／`只`／`片` 價時，整支配料、裁切與餘料計算同樣適用 `長條料.txt` 通則。不得再把方鐵整體排除於長條料通則。
- 方鐵就是實心方形截面的長條料（實心方管），完整適用 `長條料.txt` 通則；`方鐵.txt` 只保存 query、實心截面密度計重、素材長度來源／不補6M與無可用自動切工價等專屬例外。不得把方鐵描述成非長條料或只在 direct 支價時才適用長條料通則。
- AI rules 只保留會改變模型判斷、查詢、選價、計算或輸出的指示。像 query ID 產生方式、backend 並行查詢、limit clamp、內部 filter、catalog mapping、source provenance、registry metadata 等 Codex/backend 實作契約應由 code 與 tests 保證，不得放進每次注入的 AI prompt 消耗 context。
- OCR 已有同 file key data 時 runtime 與 AI 都不得自行重做；只有資料缺失／失敗，或使用者明確要求重做 OCR 時才可執行。AI OCR fallback 若已有可用資料也不能單獨成為重做理由。
- OCR 的 `t／1` 明顯誤判與公式結果不一致要直接修正，並在同列備註保留原辨識值、修正值與原因；operand 本身不清楚時才保留未確認。
- Chunk organizer 是獨立 subagent，但只需要共用 OCR 規則中的 organizer 核心（來源列、修正、備註、信心、chunk-local 表格），不需要主 Agent 的 OCR 重做條件、tool routing、final file-key 合併或報價規則。Organizer rule hash也應只根據這個子集，避免主流程文字改動使既有 chunks 失效。
- `customer_data`、`manual_review`、`customer_quote` 是 AI 最終輸出表，不要求 backend 從 assistant Markdown 持久化；不得為了補 persistence 擴張本輪 backend scope。
- OCR 共享判讀核心必須同時提供給 main AI OCR fallback 與 chunk organizer：旋正後閱讀、繁體中文，以及孔數、折邊、割型、開槽連續邊長、切角、缺口、輪廓的視覺判讀與計量。這些直接影響 AI 判斷，不得當成 backend-only 規則刪除。
- OCR Markdown 的缺值一律留空；不使用「未確認」填滿缺值，也不得以「約、略、大約、約略」等近似詞代替判斷。每筆來源 row 必須獨立保留並帶頁數、項次、件號、圖號或其他可追溯代號；同 file key 只合併表格結構，不得合併或彙總資料列。
- 注入 Agent context 的 rules 不得寫「依 `某檔案.txt`」或暗示 AI 需要讀取本地檔案；跨規則引用必須使用實際注入的 block name，例如【長條料類別規則】、【長條料切工規則】、【OCR 規則】。

import type { PriceCategory } from '../categories';

export function normalizeProductNameForCategory(productName: string): string {
  return productName
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isPipeFitting(text: string): boolean {
  return /彎頭|三通|接頭|管帽|管塞|法蘭|由令|套管|束接/u.test(text);
}

function inferDomainProductCategory(text: string): PriceCategory | undefined {
  if (/^(?:修改門板工資|型鋼結筒加工費|組合工資)$/u.test(text)) {
    return '加工/其他';
  }
  if (/萬向接頭.*沖孔/u.test(text)) {
    return '五金/配件';
  }
  if (/天地串孔|鎖孔|把手孔/u.test(text)) {
    return '門窗/門板';
  }
  if (
    /鑽孔機|沖孔機|天車(?:剪床|沖孔|折床)|鑽孔.*鎖螺絲|鎖浪板機\s+LY|氬焊機|電焊機|防火證明|防火証明|曬衣架|工具背帶|六角套筒|^借--|押金/u.test(
      text,
    )
  ) {
    return '其他';
  }
  if (
    /百葉窗用.*[螺鏍]絲|調[合和]漆|鋸片|切石片|切割器|電極火嘴|火嘴.*切割機用|浪板剪|鎖浪板機AGP|採光罩.*壓條|水槽漏斗|水槽架|七字收邊組合|梅花封頭|簷口瓦.*(?:塑膠|鐵製|--.*鐵灰)|逃生口|自然通風器|採光天窗|安全網掛鉤|無角鐵|黑鐵-鐵板把手|雕花(?:大柱|美術大柱)|大柱底座/u.test(
      text,
    )
  ) {
    return '五金/配件';
  }
  if (/格板[鏍螺]絲/u.test(text)) {
    return '捲門/伸縮門';
  }
  if (/格板|隔板/u.test(text)) {
    return '格板/隔板';
  }
  if (/PC板切|槽型鐵板入框|收邊柱包/u.test(text)) {
    return '板/浪板';
  }
  if (
    /錏板折.*檔泥板/u.test(text) ||
    /(?:黑鐵板|OT板|OT花板|STNO1|NO1\s*板|黑板|錏板|花板)(?:切(?!圓|內外圓)(?:清|\s*型)?|.*雷射切割|.*剪床切清)/iu.test(
      text,
    )
  ) {
    return '鐵板';
  }
  if (/(?:圓管|鋼管|A管|B管)/u.test(text) && !isPipeFitting(text) && !/鋸工|切工/u.test(text)) {
    return '圓管';
  }
  if (/氣密窗|擋水板|檔水板|白鐵-鐵板把手/u.test(text)) {
    return '門窗/門板';
  }
  if (
    /修改門板工資|名流.*門板|(?:ST|鍍)\s*(?:60|75|100)型封頭|佑享|祐享|乙元|添誠.*(?:開關|腳座)|格來得.*(?:馬達|控制箱)|馬達.*控制箱|大門機|電動培林|碗型套板|格板[鏍螺]絲|底座.*平鐵|雙吊輪|^ST\s*(?:2B|BA)\s*100型/iu.test(
      text,
    )
  ) {
    return '捲門/伸縮門';
  }

  return undefined;
}

function isProcessingCategory(text: string): PriceCategory | undefined {
  if (/開槽/u.test(text)) {
    return '加工/開槽';
  }
  if (/倒角|切斜角/u.test(text)) {
    return '加工/倒角';
  }
  if (/^焊工$|焊接加工|點焊加工|電焊加工|氬焊加工/u.test(text)) {
    return '加工/焊接';
  }
  if (/板折|折工|折型|折角|折彎|折斗笠/u.test(text)) {
    return '加工/折工';
  }
  if (/沖孔|沖.*孔|鑽\s*孔|攻牙|魚眼孔|橢圓孔|鎖孔|把手孔|天地串孔|萬向接頭.*孔/u.test(text)) {
    return '加工/孔';
  }
  if (
    /CNC切割|雷射切割|^雷射$|雷圓|板切|鋸工|切工|切圓|切內外圓|電離子(?:割|切割)|剪床切|氧切|鋸台切|圓條切/u.test(
      text,
    )
  ) {
    return '加工/切工';
  }
  if (
    /雷射畫線|板滾|滾圓|滾喇叭桶|H\s*鐵滾工|管類滾工|端板|壓花|拋工資|拋光|噴砂|另加烤漆|熱浸鍍鋅費|^雕花$|^保護$|厚板部加工|整平/u.test(
      text,
    )
  ) {
    return '加工/其他';
  }

  return undefined;
}

function isSheetProduct(text: string): PriceCategory | undefined {
  if (/格板|隔板/u.test(text)) {
    return '格板/隔板';
  }
  if (
    /樓層板|浪板|琉璃瓦|PC板|PU板|OPP板|樹脂板|壁板|採光|圍籬板|槽型鐵板入框|收邊|棟瓦|中棟|水槽|山牆|柱包|水切|台度|包角|簷口|吊筋|角座|牙條/u.test(
      text,
    )
  ) {
    return '板/浪板';
  }
  if (/鐵板|黑板|錏板|OT板|ST\s*(?:2B|BA|HL|NO1)|ST(?:2B|BA|HL|NO1)|花板|網板/u.test(text)) {
    return '鐵板';
  }

  return undefined;
}

function isStructuralProduct(text: string): PriceCategory | undefined {
  if (/扁方管/u.test(text)) {
    return '扁方管';
  }
  if (/方管/u.test(text)) {
    return '方管';
  }
  if (/(?:圓管|鋼管|A管|B管)/u.test(text) || (/配管/u.test(text) && !isPipeFitting(text))) {
    return '圓管';
  }
  if (/H型鋼|輕量H|H鐵/u.test(text)) {
    return 'H型鋼';
  }
  if (/I字鐵|工字鐵|I型鋼/u.test(text)) {
    return 'I型鋼/工字鐵';
  }
  if (/T型鋼/u.test(text)) {
    return 'T型鋼';
  }
  if (/C型鋼|輕型鋼|型鋼結筒|(?:黑鐵|錏|白鐵)型鋼|樑柱/u.test(text)) {
    return 'C型鋼';
  }
  if (/平鐵/u.test(text)) {
    return '平鐵';
  }
  if (/方鐵/u.test(text)) {
    return '方鐵';
  }
  if (/角鐵|角鋼/u.test(text)) {
    return '角鐵';
  }
  if (/圓條|圓鐵|光圓/u.test(text)) {
    return '圓條';
  }
  if (/鋼筋|節竹鐵|竹節/u.test(text)) {
    return '鋼筋';
  }
  if (/鐵軌/u.test(text)) {
    return '鐵軌';
  }
  if (/槽鐵/u.test(text)) {
    return '槽鐵';
  }
  if (/點焊(?:鋼絲)?網|牛筋網|刺網|高床網|浪型網|菱形網|菱型網|鐵網|安全網|^ST網/u.test(text)) {
    return '網';
  }

  return undefined;
}

function isDoorProduct(text: string): PriceCategory | undefined {
  if (
    /捲門|捲簾|伸縮門|邊柱|中柱|中住|底支|門片|簾片|捲軸|滾筒|佑享馬達|乙元馬達|遙控器|發射器|開閉機/u.test(
      text,
    )
  ) {
    return '捲門/伸縮門';
  }
  if (
    /門花|花門|窗花|花窗|鋁窗|百葉窗|氣密窗|紗網|紗窗|紗門|門板|門扇|銅門|白鐵門|防火門|天地串|門弓器|閉門器|擋水板|檔水板|門鎖|雕花把手|(?:上片|下片).*電解|扁中式.*電解/u.test(
      text,
    )
  ) {
    return '門窗/門板';
  }

  return undefined;
}

function isHardwareProduct(text: string): boolean {
  return /螺絲|螺栓|螺母|螺帽|華司|壁虎|錨栓|鉚釘|鑽尾|穴鋸|丸鋸|鋸片|砂輪|磨片|切片|切石片|鑽頭|銑刀|鋼刷|彎頭|三通|接頭|管帽|管塞|法蘭|扶手|花管|欄杆|球頭|柱頭|大柱|鑄花|鍛花|油漆|底漆|面漆|紅丹|香蕉水|矽利康|AB膠|植筋膠|膠帶|後鈕|鉸鏈|合頁|門鎖|鎖扣|插銷|門栓|焊條|焊絲|鎢棒|彈簧|伸縮器|培林|軸承|鏈條|齒輪|皮帶|馬達箱|控制箱|開關|電線|電纜|插座|變壓器|電池|板手|鉗|鎚|安全帶|工具|機具|焊機|輪子|滑輪|切割器/u.test(
    text,
  );
}

export function inferPriceCategoryCandidate(productName: string): PriceCategory | undefined {
  const text = normalizeProductNameForCategory(productName);
  const domainCategory = inferDomainProductCategory(text);
  if (domainCategory) {
    return domainCategory;
  }
  const inferred = isProcessingCategory(text) ?? isDoorProduct(text);
  if (inferred) {
    return inferred;
  }
  if (isHardwareProduct(text)) {
    return '五金/配件';
  }

  return isSheetProduct(text) ?? isStructuralProduct(text);
}

export function inferPriceCategory(productName: string): PriceCategory {
  return inferPriceCategoryCandidate(productName) ?? '其他';
}

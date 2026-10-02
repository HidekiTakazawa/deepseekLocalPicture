/**
 * 中国語写真作文 - フロントエンド Vue 3 アプリケーションロジック (DeepSeek版)
 */

const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
  setup() {
    // ===== 状態管理 =====
    const configGasUrl = (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) ? CONFIG.GAS_URL.trim() : '';
    const gasUrl = ref(configGasUrl);

    const isDarkTheme = ref(localStorage.getItem('cn_photo_essay_theme') === 'dark');
    const isDemoMode = ref(!gasUrl.value);

    // 画像・解析状態
    const currentImage = ref(null);
    const isAnalyzing = ref(false);
    const analysisData = ref(null);

    // 作文・添削状態
    const userEssay = ref('');
    const isCheckingEssay = ref(false);
    const correctionData = ref(null);

    // UIタブ
    const activeTab = ref('words');
    const modelLevel = ref('beginner');
    const essayTextarea = ref(null);
    const isPrinting = ref(false);

    // トースト通知
    const toasts = ref([]);
    const showToast = (message, type = 'info') => {
      const id = Date.now() + Math.random();
      toasts.value.push({ id, message, type });
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 4500);
    };

    // プリント機能
    const printLearningMaterial = () => {
      if (!currentImage.value) {
        showToast('印刷するデータがありません。画像をアップロードして解析してください。', 'warning');
        return;
      }
      isPrinting.value = true;
      nextTick(() => {
        window.print();
        isPrinting.value = false;
      });
    };

    // 初期化
    onMounted(() => {
      if (isDarkTheme.value) {
        document.body.classList.add('dark-theme');
      }
      loadSamplePreset('cafe');
    });

    // ===== テーマ切り替え =====
    const toggleTheme = () => {
      isDarkTheme.value = !isDarkTheme.value;
      if (isDarkTheme.value) {
        document.body.classList.add('dark-theme');
        localStorage.setItem('cn_photo_essay_theme', 'dark');
      } else {
        document.body.classList.remove('dark-theme');
        localStorage.setItem('cn_photo_essay_theme', 'light');
      }
    };


    // ===== 画像選択・ドロップ処理 =====
    const handleFileChange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) processFile(file);
    };

    const handleDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        processFile(file);
      }
    };

    // 画像のリサイズ・圧縮＆Base64変換（DeepSeek Vision最適化: 最大800px & 0.80品質）
    const processFile = (file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 800;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = 'image/jpeg';
          const base64 = canvas.toDataURL(mimeType, 0.80);

          currentImage.value = {
            id: 'img_' + Date.now(),
            base64: base64,
            mimeType: mimeType,
            name: file.name,
            previewUrl: base64
          };

          analysisData.value = null;
          correctionData.value = null;
          userEssay.value = '';

          showToast('画像を読み込みました。「✨ AIで画像を解析」を押してください', 'info');
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    };

    // ===== 画像解析リクエスト（DeepSeek マルチモーダル） =====
    const analyzeImage = async (forceReanalyze = false) => {
      if (!currentImage.value) return;

      isAnalyzing.value = true;
      activeTab.value = 'words';

      if (isDemoMode.value || !gasUrl.value) {
        setTimeout(() => {
          analysisData.value = getDemoAnalysis();
          isAnalyzing.value = false;
          showToast(forceReanalyze ? '【デモモード】AIで再解析しました' : '【デモモード】画像解析が完了しました', 'success');
        }, 800);
        return;
      }

      try {
        const payload = {
          action: 'analyze_image',
          imageBase64: currentImage.value.base64,
          mimeType: currentImage.value.mimeType,
          fileName: currentImage.value.name,
          forceReanalyze: !!forceReanalyze
        };

        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });

        const res = await response.json();
        if (res.status === 'success' && res.data) {
          analysisData.value = res.data.analysis;

          saveToHistory(getCurrentImageId(), {
            base64: currentImage.value.base64,
            mimeType: currentImage.value.mimeType,
            name: currentImage.value.name,
            analysisData: res.data.analysis,
            sceneDescription: res.data.analysis.scene_description_ja
          });

          showToast('✨ AI（DeepSeek）による画像解析が完了しました！', 'success');
        } else {
          showToast(res.message || '解析に失敗しました', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('通信エラーが発生しました: ' + err.message, 'error');
      } finally {
        isAnalyzing.value = false;
      }
    };

    // ===== 作文添削リクエスト（DeepSeek） =====
    const checkEssay = async () => {
      if (!userEssay.value.trim()) {
        showToast('作文を入力してください', 'warning');
        return;
      }

      isCheckingEssay.value = true;
      activeTab.value = 'correction';

      if (isDemoMode.value || !gasUrl.value) {
        setTimeout(() => {
          correctionData.value = getDemoCorrection(userEssay.value);
          isCheckingEssay.value = false;
          showToast('【デモモード】添削が完了しました', 'success');
        }, 1000);
        return;
      }

      try {
        let imageContext = '';
        if (analysisData.value) {
          imageContext = `画像概要: ${analysisData.value.scene_description_ja || ''}\n主な単語: ${
            (analysisData.value.words || []).map(w => w.word).join(', ')
          }`;
        }

        const payload = {
          action: 'check_essay',
          userEssay: userEssay.value,
          imageContext: imageContext,
          fileName: (currentImage.value && currentImage.value.name) ? currentImage.value.name : 'photo.jpg'
        };

        const response = await fetch(gasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });

        const res = await response.json();
        if (res.status === 'success' && res.data) {
          correctionData.value = res.data;

          saveToHistory(getCurrentImageId(), {
            userEssay: userEssay.value,
            correctionData: res.data
          });

          showToast('✨ 作文の添削が完了しました！', 'success');
        } else {
          showToast(res.message || '添削に失敗しました', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('通信エラーが発生しました: ' + err.message, 'error');
      } finally {
        isCheckingEssay.value = false;
      }
    };

    // ===== 単語挿入・読み上げ・サンプル（変更なし） =====
    const insertWordToEssay = (word) => {
      if (!word) return;
      if (!userEssay.value) {
        userEssay.value = word;
      } else {
        userEssay.value += (userEssay.value.endsWith(' ') || userEssay.value.endsWith('，') || userEssay.value.endsWith('。') ? '' : ' ') + word;
      }
      showToast(`「${word}」を作文に挿入しました`, 'info');
      nextTick(() => {
        if (essayTextarea.value) {
          essayTextarea.value.focus();
        }
      });
    };

    const speakChinese = (text) => {
      if (!window.speechSynthesis) {
        showToast('お使いのブラウザは音声合成に対応していません', 'warning');
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.85;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));
      if (zhVoice) utterance.voice = zhVoice;

      window.speechSynthesis.speak(utterance);
    };

    // ===== サンプルプリセット（変更なし） =====
    const loadSamplePreset = (type) => {
      let sampleImgUrl = '';
      let fileName = '';

      if (type === 'cafe') {
        sampleImgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
            <rect width="600" height="400" fill="#fef3c7"/>
            <rect x="50" y="240" width="500" height="20" fill="#b45309" rx="5"/>
            <path d="M 220 180 L 230 240 L 370 240 L 380 180 Z" fill="#ffffff" stroke="#d97706" stroke-width="4"/>
            <path d="M 375 195 C 400 195 400 225 375 225" fill="none" stroke="#d97706" stroke-width="4"/>
            <ellipse cx="300" cy="180" rx="80" ry="20" fill="#78350f"/>
            <path d="M 280 160 Q 270 140 280 120" stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M 300 160 Q 310 140 300 120" stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M 320 160 Q 310 140 320 120" stroke="#f59e0b" stroke-width="3" fill="none" stroke-linecap="round"/>
            <rect x="120" y="160" width="70" height="80" fill="#0284c7" rx="6"/>
            <rect x="130" y="170" width="50" height="4" fill="#ffffff" rx="2"/>
            <rect x="130" y="180" width="40" height="4" fill="#ffffff" rx="2"/>
            <rect x="130" y="190" width="45" height="4" fill="#ffffff" rx="2"/>
            <text x="300" y="80" font-size="24" font-weight="bold" fill="#78350f" text-anchor="middle" font-family="sans-serif">☕ 咖啡厅 (Café)</text>
            <text x="300" y="320" font-size="16" fill="#92400e" text-anchor="middle" font-family="sans-serif">画像をクリックして解析できます</text>
          </svg>
        `);
        fileName = 'cafe_illustration.svg';
      } else if (type === 'park') {
        sampleImgUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
            <rect width="600" height="400" fill="#ecfdf5"/>
            <circle cx="480" cy="100" r="45" fill="#fbbf24"/>
            <path d="M 0 320 Q 300 260 600 320 L 600 400 L 0 400 Z" fill="#10b981"/>
            <rect x="120" y="220" width="25" height="90" fill="#78350f"/>
            <circle cx="132" cy="180" r="60" fill="#059669"/>
            <circle cx="150" cy="150" r="45" fill="#34d399"/>
            <circle cx="110" cy="150" r="45" fill="#10b981"/>
            <rect x="360" y="270" width="120" height="15" fill="#b45309" rx="4"/>
            <rect x="375" y="285" width="8" height="25" fill="#78350f"/>
            <rect x="455" y="285" width="8" height="25" fill="#78350f"/>
            <text x="300" y="70" font-size="24" font-weight="bold" fill="#065f46" text-anchor="middle" font-family="sans-serif">🌳 公园 (Park)</text>
          </svg>
        `);
        fileName = 'park_illustration.svg';
      }

      currentImage.value = {
        base64: sampleImgUrl,
        mimeType: 'image/svg+xml',
        name: fileName,
        previewUrl: sampleImgUrl
      };

      analysisData.value = getDemoAnalysis(type);
      userEssay.value = type === 'cafe' ? '我在咖啡厅喝咖啡。咖啡很好喝，我很喜欢看书。' : '今天天气很好。公园里有很大的树，很多人散步。';
    };

    // ===== デモデータ（変更なし） =====
    const getDemoAnalysis = (type = 'cafe') => {
      if (type === 'cafe') {
        return {
          scene_description_ja: "静かなカフェのテーブルに置かれた温かいコーヒーと本",
          words: [
            { word: "咖啡", pinyin: "kāfēi", pos: "名詞", meaning: "コーヒー", example_cn: "我每天早上喝一杯热咖啡。", example_pinyin: "Wǒ měitiān zǎoshang hē yì bēi rè kāfēi.", example_ja: "私は毎朝温かいコーヒーを一杯飲みます。" },
            { word: "咖啡厅", pinyin: "kāfēitīng", pos: "名詞", meaning: "カフェ、喫茶店", example_cn: "这家咖啡厅的环境很安静。", example_pinyin: "Zhè jiā kāfēitīng de huánjìng hěn ānjìng.", example_ja: "このカフェの雰囲気はとても静かです。" },
            { word: "书", pinyin: "shū", pos: "名詞", meaning: "本", example_cn: "桌子上放着一本中文书。", example_pinyin: "Zhuōzi shang fàngzhe yì běn Zhōngwén shū.", example_ja: "机の上に中国語の本が一冊置かれています。" },
            { word: "杯子", pinyin: "bēizi", pos: "名詞", meaning: "コップ、カップ", example_cn: "这个白色的杯子很漂亮。", example_pinyin: "Zhè ge báisè de bēizi hěn piàoliang.", example_ja: "この白いカップはとても綺麗です。" },
            { word: "安静", pinyin: "ānjìng", pos: "形容詞", meaning: "静かである", example_cn: "图书馆里非常安静。", example_pinyin: "Túshūguǎn li fēicháng ānjìng.", example_ja: "図書館の中はとても静かです。" },
            { word: "看书", pinyin: "kàn shū", pos: "動詞フレーズ", meaning: "読書する、本を読む", example_cn: "我喜欢边喝茶边看书。", example_pinyin: "Wǒ xǐhuan biān hē chá biān kàn shū.", example_ja: "私はお茶を飲みながら本を読むのが好きです。" },
            { word: "桌子", pinyin: "zhuōzi", pos: "名詞", meaning: "机、テーブル", example_cn: "木头桌子上干干净净的。", example_pinyin: "Mùtou zhuōzi shang gāngānjìngjìng de.", example_ja: "木製の机の上はとても清潔です。" },
            { word: "享受", pinyin: "xiǎngshòu", pos: "動詞", meaning: "楽しむ、享受する", example_cn: "我很享受周末的悠闲时光。", example_pinyin: "Wǒ hěn xiǎngshòu zhōumò de yōuxián shíguāng.", example_ja: "私は週末ののんびりした時間を楽しんでいます。" }
          ],
          model_essays: {
            beginner: { level_title: "初級（HSK 1-2 レベル）", essay_cn: "桌子上有一杯热咖啡和一本书。我在安静的咖啡厅里看书。咖啡很好喝，我很开心。", essay_pinyin: "Zhuōzi shang yǒu yì bēi rè kāfēi hé yì běn shū. Wǒ zài ānjìng de kāfēitīng li kàn shū. Kāfēi hěn hǎohē, wǒ hěn kāixīn.", essay_ja: "机の上に温かいコーヒーが一杯と本が一冊あります。私は静かなカフェで本を読んでいます。コーヒーは美味しくて、とても楽しいです。", key_points: ["「在〜里 (〜の中で)」の場所表現", "「有一杯〜 (〜が一杯ある)」の量詞の使い方"] },
            intermediate: { level_title: "中級（HSK 3-4 レベル）", essay_cn: "在这个阳光明媚的下午，我来到了常去的咖啡厅。木桌上冒着热气的咖啡散发着浓郁的香味，旁边放着一本读到一半的小说。一边品尝咖啡一边静下心来读书，这种悠闲的时光让人感到格外轻松惬意。", essay_pinyin: "Zài zhè ge yángguāng míngmèi de xiàwǔ, wǒ láidào le cháng qù de kāfēitīng. Mùzhuō shang màozhe rèqì de kāfēi sànfāzhe nóngyù de xiāngwèi, pángbiān fàngzhe yì běn dú dào yíbàn de xiǎoshuō. Yìbiān pǐncháng kāfēi yìbiān jìng xia xīn lai dú shū, zhè zhǒng yōuxián de shíguāng ràng rén gǎndào géwài qīngsōng qièyì.", essay_ja: "陽の光が心地よい午後に、私はいつものカフェにやってきました。木製テーブルの湯気立つコーヒーからは芳醇な香りが漂い、傍らには読みかけの小説が置かれています。コーヒーを味わいながら心を落ち着かせて読書する、このようなゆったりした時間は格別にリラックスして心地よいものです。", key_points: ["「一边〜一边… (〜しながら…する)」の並行動作構文", "「着 (〜している)」を用いた状態描写 (冒着热气、放着)", "「让 (使役: 〜させる)」の構文"] }
          }
        };
      } else {
        return {
          scene_description_ja: "緑豊かな公園と青空、木陰のベンチ",
          words: [
            { word: "公园", pinyin: "gōngyuán", pos: "名詞", meaning: "公園", example_cn: "周末很多人去公园玩。", example_pinyin: "Zhōumò hěn duō rén qù gōngyuán wán.", example_ja: "週末は多くの人が公園に遊びに行きます。" },
            { word: "大树", pinyin: "dàshù", pos: "名詞", meaning: "大きな木", example_cn: "大树下很凉快。", example_pinyin: "Dàshù xià hěn liángkuai.", example_ja: "大きな木の下はとても涼しいです。" },
            { word: "散步", pinyin: "sànbù", pos: "動詞 (離合詞)", meaning: "散歩する", example_cn: "吃完晚饭后我们去散散步吧。", example_pinyin: "Chī wán wǎnfàn hòu wǒmen qù sànsan bù ba.", example_ja: "晩ご飯を食べた後、少し散歩に行きましょう。" },
            { word: "长椅", pinyin: "chángyǐ", pos: "名詞", meaning: "ベンチ、長椅子", example_cn: "他在公园的长椅上休息。", example_pinyin: "Tā zài gōngyuán de chángyǐ shang xiūxi.", example_ja: "彼は公園のベンチで休憩しています。" }
          ],
          model_essays: {
            beginner: { level_title: "初級（HSK 1-2 レベル）", essay_cn: "今天天气非常好。公园里有绿色的大树和舒服的长椅。许多人在公园里散步。", essay_pinyin: "Jīntiān tiānqì fēicháng hǎo. Gōngyuán li yǒu lǜsè de dàshù hé shūfu de chángyǐ. Xǔduō rén zài gōngyuán li sànbù.", essay_ja: "今日の天気はとても良いです。公園には緑の大木と快適なベンチがあります。多くの人が公園で散歩しています。", key_points: ["天気の表現", "場所 + 有 + 目的語 の存在文"] },
            intermediate: { level_title: "中級（HSK 3-4 レベル）", essay_cn: "阳光洒在郁郁葱葱的公园里。微风吹过树梢，让人心旷神怡。坐在长椅上静静地看着散步的人们，感受大自然的美好。", essay_pinyin: "Yángguāng sǎ zài yùyùcōngcōng de gōngyuán li. Wēifēng chuī guò shùshāo, ràng rén xīnkuàng-shényí. Zuò zài chángyǐ shang jìngjìng de kànzhe sànbù de rénmen, gǎnshòu dàzìrán de měihǎo.", essay_ja: "青々とした公園に陽の光が降り注いでいます。そよ風が木々の梢を吹き抜け、心を晴れやかにしてくれます。ベンチに座って散歩する人々を静かに眺めながら、大自然の素晴らしさを感じています。", key_points: ["成語「心旷神怡 (気分爽快である)」", "情景描写の動詞「洒 (注ぐ)」"] }
          }
        };
      }
    };

    const getDemoCorrection = (input) => {
      return {
        score: 92,
        score_comment: "素晴らしい作文です！情景が明確で、基本的な語順もしっかり身についています。より自然な中国語表現に微調整しました。",
        corrected_essay: "我正在咖啡厅里喝咖啡。这里的咖啡非常好喝，我也很喜欢在这里看书。",
        corrected_pinyin: "Wǒ zhèngzài kāfēitīng li hē kāfēi. Zhèli de kāfēi fēicháng hǎohē, wǒ yě hěn xǐhuan zài zhèli kàn shū.",
        corrected_ja: "私はちょうどカフェでコーヒーを飲んでいるところです。ここのコーヒーはとても美味しく、私はここで読書をするのも大好きです。",
        corrections: [
          { original: "在咖啡厅", corrected: "在咖啡厅里 / 正在咖啡厅里", pinyin: "zài kāfēitīng li / zhèngzài kāfēitīng li", reason: "「〜の中で」を表すときは「在 + 場所 + 里」とするのが自然です。また「正在」を加えると動作の臨場感が出ます。" },
          { original: "我很喜欢看书", corrected: "我也很喜欢在这里看书", pinyin: "wǒ yě hěn xǐhuan zài zhèli kàn shū", reason: "「ここで本を読むのが好き」と場所の副詞句「在这里」を動詞の前に補うと、前の文との繋がりがより自然になります。" }
        ],
        better_expressions: [
          { expression: "一边喝咖啡，一边看书", pinyin: "yìbiān hē kāfēi, yìbiān kàn shū", meaning: "コーヒーを飲みながら本を読む（2つの動作の同時進行構文）" },
          { expression: "享受悠闲的时光", pinyin: "xiǎngshòu yōuxián de shíguāng", meaning: "のんびりとした時間を楽しむ（カフェ描写にぴったりの表現）" }
        ],
        grammar_tips: [
          "中国語の語順ルール: 「主語 + [時間/場所/方法] + 動詞 + 目的語」（日本語と違い、場所は動詞の前に置きます）",
          "形容詞述語文: 「很」は単なる「とても」の意味だけでなく、形容詞述語文で語調を整えるために自然に添えられます。"
        ]
      };
    };

    // ===== IndexedDB ローカル履歴管理 =====
    // GAS_URLを元にDB名を動的に生成し、接続先ごとに履歴を分離する
    const DB_NAME = 'PhotoEssayDB_' + (gasUrl.value ? btoa(gasUrl.value).replace(/=/g, '').slice(0, 15) : 'demo');
    const STORE_NAME = 'history';
    let dbPromise = null;

    const initDB = () => {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          try {
            if (!window.indexedDB) throw new Error('このブラウザはIndexedDBをサポートしていません');
            const request = window.indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
              const db = e.target.result;
              if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
              }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          } catch (e) {
            reject(e);
          }
        });
      }
      return dbPromise;
    };

    const saveToHistory = async (id, dataObj) => {
      try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const existing = getReq.result || { id, dateCreated: new Date().toISOString() };
          const updated = { ...existing, ...dataObj, dateUpdated: new Date().toISOString() };
          store.put(updated);
        };
      } catch (err) {
        console.error('IndexedDB Save Error:', err);
      }
    };

    const getHistoryList = async () => {
      try {
        const db = await initDB();
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => {
            const sorted = (req.result || []).sort((a, b) => new Date(b.dateUpdated || b.dateCreated) - new Date(a.dateUpdated || a.dateCreated));
            resolve(sorted);
          };
        });
      } catch (err) {
        console.error('IndexedDB Load Error:', err);
        return [];
      }
    };

    const deleteHistoryItem = async (id) => {
      try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        await loadHistoryFiles();
      } catch (err) {
        console.error('IndexedDB Delete Error:', err);
      }
    };

    const showHistoryModal = ref(false);
    const historyFiles = ref([]);
    const isLoadingHistory = ref(false);

    const openHistoryModal = async () => {
      try {
        showHistoryModal.value = true;
        await loadHistoryFiles();
      } catch (e) {
        console.error('Error opening history modal:', e);
        alert('履歴の表示中にエラーが発生しました: ' + e.message);
      }
    };

    const closeHistoryModal = () => { showHistoryModal.value = false; };

    const loadHistoryFiles = async () => {
      isLoadingHistory.value = true;
      historyFiles.value = await getHistoryList();
      isLoadingHistory.value = false;
    };

    const selectHistoryFile = (file) => {
      currentImage.value = {
        id: file.id,
        base64: file.base64,
        mimeType: file.mimeType || 'image/jpeg',
        name: file.name,
        previewUrl: file.base64
      };
      analysisData.value = file.analysisData || null;
      userEssay.value = file.userEssay || '';
      correctionData.value = file.correctionData || null;
      activeTab.value = 'words';
      showToast(`履歴から「${file.name}」を読み込みました`, 'success');
      closeHistoryModal();
    };

    const getCurrentImageId = () => {
      if (!currentImage.value) return null;
      if (!currentImage.value.id) {
        currentImage.value.id = 'img_' + Date.now();
      }
      return currentImage.value.id;
    };

    // ===== return =====
    return {
      // 設定 & テーマ
      gasUrl,
      isDarkTheme,
      isDemoMode,
      toggleTheme,

      // 画像 & 解析
      currentImage,
      isAnalyzing,
      analysisData,
      handleFileChange,
      handleDrop,
      analyzeImage,
      loadSamplePreset,

      // 履歴管理
      showHistoryModal,
      historyFiles,
      isLoadingHistory,
      openHistoryModal,
      closeHistoryModal,
      selectHistoryFile,
      deleteHistoryItem,

      // 作文 & 添削
      userEssay,
      isCheckingEssay,
      correctionData,
      checkEssay,
      insertWordToEssay,
      essayTextarea,

      // UI
      activeTab,
      modelLevel,
      speakChinese,
      toasts,

      // 印刷機能
      isPrinting,
      printLearningMaterial
    };
  }
}).mount('#app');
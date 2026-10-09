/**
 * 中国語写真作文 - フロントエンド Vue 3 アプリケーションロジック (DeepSeek版)
 */

const { createApp, ref, computed, onMounted, nextTick } = Vue;

const safeStorage = {
  get(key, defaultValue) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(e);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(e);
    }
  }
};

createApp({
  setup() {
    // ===== 状態管理 =====
    const configGasUrl = (typeof CONFIG !== 'undefined' && CONFIG.GAS_URL) ? CONFIG.GAS_URL.trim() : '';
    const configLicenseUrl = (typeof CONFIG !== 'undefined' && CONFIG.LICENSE_GAS_URL) ? CONFIG.LICENSE_GAS_URL.trim() : '';
    const licenseGasUrl = ref(configLicenseUrl);

    // ライセンス認証関連
    const currentLicenseKey = ref(safeStorage.get('chineseAppLicenseKey', ''));
    const licenseKeyInput = ref(currentLicenseKey.value);
    const isAuthenticated = ref(!!currentLicenseKey.value);
    const isAuthenticating = ref(false);

    const login = async () => {
      if (!licenseKeyInput.value.trim()) {
        showToast('ライセンスキーを入力してください。', 'error');
        return;
      }
      if (!licenseGasUrl.value) {
        currentLicenseKey.value = licenseKeyInput.value;
        safeStorage.set('chineseAppLicenseKey', currentLicenseKey.value);
        isAuthenticated.value = true;
        showToast('認証をスキップしました(サーバー未設定)', 'info');
        return;
      }
      isAuthenticating.value = true;
      try {
        const response = await fetch(licenseGasUrl.value, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'verifyLicense', licenseKey: licenseKeyInput.value }),
          redirect: 'follow'
        });
        const data = await response.json();
        if (data.error) {
          alert("エラー: " + data.error);
          showToast(data.error, 'error');
          isAuthenticating.value = false;
          return;
        }
        if (data.valid) {
          currentLicenseKey.value = licenseKeyInput.value;
          safeStorage.set('chineseAppLicenseKey', currentLicenseKey.value);
          isAuthenticated.value = true;
          showToast('認証に成功しました。', 'success');
        } else {
          alert("このライセンスキーは無効です。");
          showToast("このライセンスキーは無効です。", 'error');
        }
      } catch (error) {
        alert("通信エラー: " + error.message);
        showToast('通信エラー: ' + error.message, 'error');
      }
      isAuthenticating.value = false;
    };

    const logout = () => {
      currentLicenseKey.value = '';
      licenseKeyInput.value = '';
      safeStorage.remove('chineseAppLicenseKey');
      isAuthenticated.value = false;
      showToast('ログアウトしました。', 'info');
    };
    const gasUrl = ref(configGasUrl);

    const isDarkTheme = ref(localStorage.getItem('cn_photo_essay_theme') === 'dark');

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
    onMounted(async () => {
      if (isDarkTheme.value) {
        document.body.classList.add('dark-theme');
      }
      const historyList = await getHistoryList();
      if (historyList && historyList.length > 0) {
        selectHistoryFile(historyList[0]);
      }
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



      try {
        const payload = {
          action: 'analyze_image',
          imageBase64: currentImage.value.base64,
          mimeType: currentImage.value.mimeType,
          fileName: currentImage.value.name,
          forceReanalyze: !!forceReanalyze,
          licenseKey: currentLicenseKey.value
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



      try {
        let imageContext = '';
        if (analysisData.value) {
          imageContext = `画像概要: ${analysisData.value.scene_description_ja || ''}\n主な単語: ${(analysisData.value.words || []).map(w => w.word).join(', ')
            }`;
        }

        const payload = {
          action: 'check_essay',
          userEssay: userEssay.value,
          imageContext: imageContext,
          fileName: (currentImage.value && currentImage.value.name) ? currentImage.value.name : 'photo.jpg',
          licenseKey: currentLicenseKey.value
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
      toggleTheme,

      // 画像 & 解析
      currentImage,
      isAnalyzing,
      analysisData,
      handleFileChange,
      handleDrop,
      analyzeImage,

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
      printLearningMaterial,
      // 認証関連
      isAuthenticated,
      isAuthenticating,
      licenseKeyInput,
      login,
      logout
    };
  }
}).mount('#app');
document.addEventListener('DOMContentLoaded', () => {
    // 画面要素
    const screenTop = document.getElementById('screen-top');
    const screenDraw = document.getElementById('screen-draw');
    const dialogConfirm = document.getElementById('dialog-confirm');
    const dialogComplete = document.getElementById('dialog-complete');
    const dialogError = document.getElementById('dialog-error');
    const errorMessage = document.getElementById('error-message');

    // ボタン要素
    const btnStart = document.getElementById('btn-start');
    const btnBackToTop = document.getElementById('btn-back-to-top');
    const btnSubmitTrigger = document.getElementById('btn-submit-trigger');
    const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
    const btnConfirmOk = document.getElementById('btn-confirm-ok');
    const btnCompleteOk = document.getElementById('btn-complete-ok');
    const btnErrorOk = document.getElementById('btn-error-ok');
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnEraser = document.getElementById('btn-eraser');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');

    // ニックネーム入力欄
    const inputNickname = document.getElementById('input-nickname');

    // LEDマトリックスサイズ選択UI
    const matrixSizeBtns = document.querySelectorAll('.matrix-size-btn');

    // 描画関連の変数
    let isDrawing = false;
    let currentColor = '#ff4d7d'; // 初期色はピンク
    let isEraserMode = false;
    const defaultCellColor = '#ffffff';

    // キャンバスサイズ変数（HTML側で active になっているボタンに合わせて初期化する）
    const initialSizeBtn = document.querySelector('.matrix-size-btn.active') || matrixSizeBtns[0];
    let canvasWidth = parseInt(initialSizeBtn.dataset.width, 10) || 16;
    let canvasHeight = parseInt(initialSizeBtn.dataset.height, 10) || 16;

    // 履歴管理用の変数
    let historyList = [];
    let historyIndex = -1;

    // 画面遷移ロジック
    function showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    // エラーダイアログ表示
    function showErrorDialog(message) {
        errorMessage.textContent = message;
        dialogError.classList.remove('hidden');
    }

    // エラーダイアログを閉じる
    function closeErrorDialog() {
        dialogError.classList.add('hidden');
    }

    // サーバー/データベースヘルスチェック
    async function checkServerHealth() {
        try {
            const res = await fetch("http://localhost:3000/health");
            const data = await res.json();
            
            if (res.status === 200 && data.status === "ok") {
                return true;
            } else {
                return false;
            }
        } catch (err) {
            console.error("Health check error:", err);
            return false;
        }
    }

    // 1. トップ画面 -> 作成画面
    btnStart.addEventListener('click', async () => {
        const isServerReady = await checkServerHealth();
        
        if (!isServerReady) {
            showErrorDialog("❌ サーバーに接続できません\n\nサーバーが起動していることを確認してください。\n\nコマンド: node server.js");
            return;
        }
        
        showScreen(screenDraw);
        updateFlowSteps(2);
    });

    // 2. 作成画面 -> トップ画面（戻る）
    btnBackToTop.addEventListener('click', () => {
        showScreen(screenTop);
        updateFlowSteps(1);
    });

    // 3. 作成画面 -> 送信確認ダイアログ
    btnSubmitTrigger.addEventListener('click', () => {
        dialogConfirm.classList.remove('hidden');
        updateFlowSteps(3);
    });

    // 4. 送信確認ダイアログ -> キャンセル（閉じる）
    btnConfirmCancel.addEventListener('click', () => {
        dialogConfirm.classList.add('hidden');
        updateFlowSteps(2);
    });

    // 5. 送信確認ダイアログ -> 送信完了ダイアログ（送信処理実行）
    btnConfirmOk.addEventListener('click', () => {
        // データ送信処理（ダミー）を実行
        submitData();

        dialogConfirm.classList.add('hidden');
        dialogComplete.classList.remove('hidden');
        updateFlowSteps(4);
    });

    // 6. 送信完了ダイアログ -> OK（トップ画面に戻る & キャンバス初期化）
    btnCompleteOk.addEventListener('click', () => {
        dialogComplete.classList.add('hidden');
        showScreen(screenTop);
        updateFlowSteps(5);

        // キャンバスを真っ白に初期化して履歴もクリア
        initCanvas();
        inputNickname.value = ''; // ニックネームもクリア

        setTimeout(() => {
            updateFlowSteps(1);
        }, 1000);
    });

    // 7. エラーダイアログ -> OK
    btnErrorOk.addEventListener('click', () => {
        closeErrorDialog();
    });

    // ヘッダーのフロー表示更新
    function updateFlowSteps(stepNumber) {
        document.querySelectorAll('.flow-steps .step-badge').forEach((badge, idx) => {
            if (idx + 1 === stepNumber) {
                badge.classList.add('active');
            } else {
                badge.classList.remove('active');
            }
        });
    }

    // LEDマトリックスサイズ選択
    matrixSizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            matrixSizeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            canvasWidth = parseInt(btn.dataset.width);
            canvasHeight = parseInt(btn.dataset.height);
            
            initCanvas();
        });
    });

    // --- キャンバスとお絵描きロジックの実装 ---
    const pixelCanvas = document.getElementById('pixel-canvas');
    const cells = [];

    // キャンバスの初期化
    function initCanvas() {
        pixelCanvas.innerHTML = '';
        cells.length = 0;
        
        // CSS変数でグリッドサイズを設定
        pixelCanvas.style.setProperty('--canvas-cols', canvasWidth);
        pixelCanvas.style.setProperty('--canvas-rows', canvasHeight);
        
        const totalCells = canvasWidth * canvasHeight;
        
        for (let i = 0; i < totalCells; i++) {
            const cell = document.createElement('div');
            cell.classList.add('pixel-cell');
            cell.style.backgroundColor = defaultCellColor;
            cell.dataset.index = i;

            // マウスイベント
            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isDrawing = true;
                drawPixel(cell);
            });

            cell.addEventListener('mouseenter', () => {
                if (isDrawing) {
                    drawPixel(cell);
                }
            });

            pixelCanvas.appendChild(cell);
            cells.push(cell);
        }

        // 履歴をクリアして初期状態を保存
        historyList = [getCanvasState()];
        historyIndex = 0;
        updateUndoRedoButtons();
    }

    // 現在のキャンバスの状態（色配列）を取得
    function getCanvasState() {
        return cells.map(cell => cell.style.backgroundColor || defaultCellColor);
    }

    // キャンバスに状態を適用
    function applyCanvasState(state) {
        cells.forEach((cell, index) => {
            cell.style.backgroundColor = state[index] || defaultCellColor;
        });
    }

    // 新しい状態を履歴に追加
    function saveHistory() {
        const currentState = getCanvasState();
        const lastState = historyList[historyIndex];

        // 直前の履歴と状態が異なる場合のみ追加
        if (JSON.stringify(currentState) !== JSON.stringify(lastState)) {
            // 現在のインデックスより後ろのやり直し履歴（Redo履歴）を削除
            historyList = historyList.slice(0, historyIndex + 1);
            historyList.push(currentState);
            historyIndex++;
            updateUndoRedoButtons();
        }
    }

    // Undo/Redoボタンの有効・無効（透明度など）の更新
    function updateUndoRedoButtons() {
        if (btnUndo) {
            btnUndo.disabled = historyIndex <= 0;
            btnUndo.style.opacity = btnUndo.disabled ? '0.4' : '1';
        }
        if (btnRedo) {
            btnRedo.disabled = historyIndex >= historyList.length - 1;
            btnRedo.style.opacity = btnRedo.disabled ? '0.4' : '1';
        }
    }

    // 描画終了時のイベント監視
    function endDrawing() {
        if (isDrawing) {
            isDrawing = false;
            saveHistory();
        }
    }

    window.addEventListener('mouseup', endDrawing);

    // タッチデバイス対応（スマホ用）
    pixelCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDrawing = true;
        handleTouchDraw(e);
    }, { passive: false });

    pixelCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (isDrawing) {
            handleTouchDraw(e);
        }
    }, { passive: false });

    pixelCanvas.addEventListener('touchend', endDrawing);

    // タッチ位置からセルを特定して描画
    function handleTouchDraw(e) {
        if (e.touches.length === 0) return;
        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY);
        if (element && element.classList.contains('pixel-cell')) {
            drawPixel(element);
        }
    }

    // ピクセルを塗る処理
    function drawPixel(cell) {
        const color = isEraserMode ? defaultCellColor : currentColor;
        if (cell.style.backgroundColor !== color) {
            cell.style.backgroundColor = color;
        }
    }

    // カラーパレット選択
    const colorButtons = document.querySelectorAll('.color-btn');
    colorButtons.forEach(button => {
        button.addEventListener('click', () => {
            isEraserMode = false;
            btnEraser.classList.remove('active');

            colorButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            currentColor = button.dataset.color;
        });
    });

    // 消しゴムボタン
    btnEraser.addEventListener('click', () => {
        isEraserMode = !isEraserMode;
        if (isEraserMode) {
            btnEraser.classList.add('active');
            colorButtons.forEach(btn => btn.classList.remove('active'));
        } else {
            btnEraser.classList.remove('active');
            const activeColorBtn = Array.from(colorButtons).find(btn => btn.dataset.color === currentColor);
            if (activeColorBtn) activeColorBtn.classList.add('active');
        }
    });

    // 全消去ボタン
    btnClearAll.addEventListener('click', () => {
        cells.forEach(cell => {
            cell.style.backgroundColor = defaultCellColor;
        });
        saveHistory();
    });

    // もどす（Undo）
    if (btnUndo) {
        btnUndo.addEventListener('click', () => {
            if (historyIndex > 0) {
                historyIndex--;
                applyCanvasState(historyList[historyIndex]);
                updateUndoRedoButtons();
            }
        });
    }

    // やり直す（Redo）
    if (btnRedo) {
        btnRedo.addEventListener('click', () => {
            if (historyIndex < historyList.length - 1) {
                historyIndex++;
                applyCanvasState(historyList[historyIndex]);
                updateUndoRedoButtons();
            }
        });
    }

    // --- データ抽出 & 送信ダミー処理 ---
    function parseRGB(colorString) {
        // rgb(r, g, b) 形式から数値をパース
        const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10)
            };
        }
        
        // 16進数 #RRGGBB 形式の場合のパース
        if (colorString.startsWith('#')) {
            const hex = colorString.slice(1);
            if (hex.length === 3) {
                return {
                    r: parseInt(hex[0] + hex[0], 16),
                    g: parseInt(hex[1] + hex[1], 16),
                    b: parseInt(hex[2] + hex[2], 16)
                };
            } else if (hex.length === 6) {
                return {
                    r: parseInt(hex.slice(0, 2), 16),
                    g: parseInt(hex.slice(2, 4), 16),
                    b: parseInt(hex.slice(4, 6), 16)
                };
            }
        }

        // デフォルトは白
        return { r: 255, g: 255, b: 255 };
    }

    function formatDateTime(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hr = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}/${m}/${d} ${hr}:${min}`;
    }

    function submitData() {

    const nickname = inputNickname.value.trim().substring(0,30);

    const pixelData = cells.map(cell=>{
        const color = cell.style.backgroundColor || defaultCellColor;
        return parseRGB(color);
    });

    const payload = {
        nickname: nickname || "ななし",
        timestamp: formatDateTime(new Date()),
        pixels: JSON.stringify(pixelData),
        width: canvasWidth,
        height: canvasHeight
    };

    fetch("http://localhost:3000/submissions",{
        method:"POST",
        headers:{
            "Content-Type":"application/json"
        },
        body:JSON.stringify(payload)
    })
    .then(res=>{
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: 投稿に失敗しました`);
        }
        return res.json();
    })
    .then(data=>{
        console.log("保存成功",data);
    })
    .catch(err=>{
        console.error("投稿エラー:", err);
        showErrorDialog(`❌ 投稿に失敗しました\n\n${err.message}\n\nネットワーク接続やサーバーの状態を確認してください。`);
        // エラーダイアログを閉じた後、確認ダイアログも閉じる
        setTimeout(() => {
            closeErrorDialog();
            dialogConfirm.classList.add('hidden');
            updateFlowSteps(2);
        }, 3000);
    });

}

    // 初回起動時のキャンバス初期化
    initCanvas();
});

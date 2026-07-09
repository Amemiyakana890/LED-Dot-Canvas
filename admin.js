// server.js が動いているURL（ポートはserver.jsのPORTと合わせる）
const API_BASE = "http://localhost:3000";

document.addEventListener('DOMContentLoaded', () => {
    // --- 状態変数 ---
    let currentSubmissions = [];
    let activeFilter = 'all';
    let searchQuery = '';

    // スライドショー関連
    let slideshowTimer = null;
    let slideshowIndex = -1;
    let slideshowList = [];
    let isSlideshowRunning = false;

    // --- DOM要素の取得 ---
    const txtLastUpdate = document.getElementById('txt-last-update');
    const btnRefresh = document.getElementById('btn-refresh');

    // ダッシュボード
    const btnTestConnection = document.getElementById('btn-test-connection');
    const btnSlideshowStart = document.getElementById('btn-slideshow-start');
    const btnSlideshowStop = document.getElementById('btn-slideshow-stop');
    const selectInterval = document.getElementById('select-interval');
    const selectCount = document.getElementById('select-count');
    const badgeSlideshowStatus = document.getElementById('badge-slideshow-status');
    const displayInfoDetail = document.getElementById('display-info-detail');
    const ledPreviewCanvas = document.getElementById('led-preview-canvas');
    const espStatusDot = document.getElementById('esp-status-dot');
    const espStatusText = document.getElementById('esp-status-text');
    const espLastSeen = document.getElementById('esp-last-seen');
    const dbStatusDot = document.getElementById('db-status-dot');
    const dbStatusText = document.getElementById('db-status-text');

    // テーブル・一覧
    const txtTotalCount = document.getElementById('txt-total-count');
    const btnFilters = document.querySelectorAll('.btn-filter');
    const inputSearch = document.getElementById('input-search');
    const submissionsTbody = document.getElementById('submissions-tbody');
    const tableEmptyMsg = document.getElementById('table-empty-msg');

    // モーダル：プレビュー
    const modalPreview = document.getElementById('modal-preview');
    const btnClosePreviewModal = document.getElementById('btn-close-preview-modal');
    const btnPreviewClose = document.getElementById('btn-preview-close');
    const txtModalPreviewTitle = document.getElementById('txt-modal-preview-title');
    const modalPreviewCanvas = document.getElementById('modal-preview-canvas');
    const txtPreviewNickname = document.getElementById('txt-preview-nickname');
    const txtPreviewTime = document.getElementById('txt-preview-time');
    const txtPreviewSize = document.getElementById('txt-preview-size');

    // モーダル：削除
    const modalDelete = document.getElementById('modal-delete');
    const btnCloseDeleteModal = document.getElementById('btn-close-delete-modal');
    const btnDeleteCancel = document.getElementById('btn-delete-cancel');
    const btnDeleteConfirm = document.getElementById('btn-delete-confirm');
    const txtModalDeleteTitle = document.getElementById('txt-modal-delete-title');
    const modalDeleteThumbnail = document.getElementById('modal-delete-thumbnail');
    const txtDeleteNickname = document.getElementById('txt-delete-nickname');
    const txtDeleteTime = document.getElementById('txt-delete-time');
    let pendingDeleteId = null;

    function setStatusIndicator(dotElement, textElement, isConnected, connectedText, disconnectedText) {
        dotElement.classList.remove('online', 'offline', 'checking');
        dotElement.classList.add(isConnected ? 'online' : 'offline');
        textElement.textContent = isConnected ? connectedText : disconnectedText;
    }

    function formatLastSeen(timestamp) {
        if (!timestamp) return '--';
        try {
            return new Date(timestamp).toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (e) {
            return '--';
        }
    }

    async function updateConnectionStatus() {
        try {
            const res = await fetch(`${API_BASE}/status`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const espConnected = !!data?.esp32?.connected;
            const dbConnected = !!data?.database?.connected;

            setStatusIndicator(espStatusDot, espStatusText, espConnected, 'ESP32 接続', 'ESP32 未接続');
            setStatusIndicator(dbStatusDot, dbStatusText, dbConnected, 'Database 接続', 'Database 未接続');

            espLastSeen.textContent = espConnected ? formatLastSeen(data?.esp32?.lastSeenAt) : '--';
        } catch (e) {
            console.error('接続状態の取得に失敗しました:', e);
            setStatusIndicator(espStatusDot, espStatusText, false, 'ESP32 接続', 'ESP32 未接続');
            setStatusIndicator(dbStatusDot, dbStatusText, false, 'Database 接続', 'Database 未接続');
            espLastSeen.textContent = '--';
        }
    }

    // --- サーバーのレコード（is_pinned等のsnake_case）を
    //     画面側で使うisPinned等のcamelCaseに変換し、pixelsもJSON文字列→配列に変換する ---
    function normalizeSubmission(row) {
        let pixels = [];
        try {
            pixels = typeof row.pixels === 'string' ? JSON.parse(row.pixels) : row.pixels;
        } catch (e) {
            console.error('pixelsのパースに失敗しました:', e);
            pixels = [];
        }
        
        // ピクセル配列の長さからサイズを推測（データベース値があれば使用）
        let width = row.width || 16;
        let height = row.height || 16;
        
        // データベースに width/height がない場合は推測
        if (!row.width || !row.height) {
            if (pixels.length === 25) {
                width = 5; height = 5;
            } else if (pixels.length === 512) {
                width = 32; height = 16;
            } else {
                const side = Math.sqrt(pixels.length);
                if (Number.isInteger(side)) {
                    width = height = side;
                }
            }
        }
        
        return {
            id: row.id,
            nickname: row.nickname,
            timestamp: row.timestamp,
            pixels: pixels,
            width: width,
            height: height,
            isPinned: !!row.is_pinned,
            isShowing: !!row.is_showing,
            isNew: !!row.is_new
        };
    }

    // --- サーバーから作品一覧を取得 ---
    async function loadData() {
        try {
            const res = await fetch(`${API_BASE}/submissions`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = await res.json();
            currentSubmissions = rows.map(normalizeSubmission);
        } catch (e) {
            console.error('サーバーからのデータ取得に失敗しました:', e);
            currentSubmissions = [];
            if (displayInfoDetail) {
                displayInfoDetail.innerHTML = `<p class="info-empty-msg" style="color:#ef4444;">サーバー(${API_BASE})に接続できません。server.jsが起動しているか確認してください。</p>`;
            }
        }

        // 最終更新時間を更新
        const now = new Date();
        txtLastUpdate.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    }

    // --- サーバーへ部分更新（ピン留め／スライドショー対象／NEW）を送信 ---
    async function updateSubmissionOnServer(id, fields) {
        try {
            const res = await fetch(`${API_BASE}/submissions/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            console.error('更新に失敗しました:', e);
            alert('サーバーへの更新に失敗しました。通信状況を確認してください。');
        }
    }

    // --- サーバーへ削除を送信 ---
    async function deleteSubmissionOnServer(id) {
        try {
            const res = await fetch(`${API_BASE}/submissions/${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            console.error('削除に失敗しました:', e);
            alert('サーバーでの削除に失敗しました。通信状況を確認してください。');
        }
    }

    // --- ピクセルグリッド描画ヘルパー ---
    function drawPixelGrid(canvasElement, pixelsArray, width = 16, height = 16) {
        canvasElement.innerHTML = '';
        if (!pixelsArray || pixelsArray.length === 0) return;

        // CSS変数でグリッドサイズを設定（インラインスタイルで上書き）
        canvasElement.style.setProperty('--grid-cols', width);
        canvasElement.style.setProperty('--grid-rows', height);

        pixelsArray.forEach(p => {
            const dot = document.createElement('div');
            dot.style.backgroundColor = `rgb(${p.r}, ${p.g}, ${p.b})`;
            canvasElement.appendChild(dot);
        });
    }

    // --- テーブル一覧の描画 ---
    function renderTable() {
        submissionsTbody.innerHTML = '';

        // フィルタリング
        let filteredList = currentSubmissions.filter(sub => {
            // 検索フィルター
            if (searchQuery && !sub.nickname.toLowerCase().includes(searchQuery.toLowerCase())) {
                return false;
            }
            // ボタンフィルター
            if (activeFilter === 'pinned' && !sub.isPinned) return false;
            if (activeFilter === 'showing' && !sub.isShowing) return false;
            if (activeFilter === 'hidden' && sub.isShowing) return false;
            return true;
        });

        // 最新の投稿順（ID降順）にソート
        filteredList.sort((a, b) => b.id - a.id);

        txtTotalCount.textContent = currentSubmissions.length;

        if (filteredList.length === 0) {
            tableEmptyMsg.classList.remove('hidden');
            return;
        }
        tableEmptyMsg.classList.add('hidden');

        filteredList.forEach(sub => {
            const tr = document.createElement('tr');

            // ID
            const tdId = document.createElement('td');
            const idWrapper = document.createElement('div');
            idWrapper.classList.add('id-cell-wrapper');
            idWrapper.textContent = sub.id;
            if (sub.isNew) {
                const badgeNew = document.createElement('span');
                badgeNew.classList.add('badge-new');
                badgeNew.textContent = 'NEW';
                idWrapper.appendChild(badgeNew);
            }
            tdId.appendChild(idWrapper);
            tr.appendChild(tdId);

            // サムネイル
            const tdThumb = document.createElement('td');
            const thumbCanvas = document.createElement('div');
            thumbCanvas.classList.add('table-pixel-thumbnail');
            drawPixelGrid(thumbCanvas, sub.pixels, sub.width, sub.height);
            tdThumb.appendChild(thumbCanvas);
            tr.appendChild(tdThumb);

            // ニックネーム
            const tdNickname = document.createElement('td');
            tdNickname.textContent = sub.nickname;
            tdNickname.style.fontWeight = '700';
            tr.appendChild(tdNickname);

            // 投稿日時
            const tdTime = document.createElement('td');
            tdTime.textContent = sub.timestamp;
            tdTime.style.color = '#64748b';
            tr.appendChild(tdTime);

            // ピン留め (★)
            const tdPin = document.createElement('td');
            tdPin.style.textAlign = 'center';
            const btnPin = document.createElement('button');
            btnPin.classList.add('btn-pin');
            if (sub.isPinned) btnPin.classList.add('pinned');
            btnPin.innerHTML = sub.isPinned ? '★' : '☆';
            btnPin.addEventListener('click', async () => {
                sub.isPinned = !sub.isPinned;
                renderTable();
                await updateSubmissionOnServer(sub.id, { is_pinned: sub.isPinned });
                if (isSlideshowRunning) updateSlideshowList(); // 再生リスト即時更新
            });
            tdPin.appendChild(btnPin);
            tr.appendChild(tdPin);

            // スライドショー対象トグル
            const tdToggle = document.createElement('td');
            const toggleWrapper = document.createElement('div');
            toggleWrapper.classList.add('toggle-wrapper');

            const labelToggleText = document.createElement('span');
            labelToggleText.classList.add('toggle-label-text');
            if (sub.isShowing) labelToggleText.classList.add('active');
            labelToggleText.textContent = sub.isShowing ? 'ON' : 'OFF';

            const switchLabel = document.createElement('label');
            switchLabel.classList.add('switch');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = sub.isShowing;
            checkbox.addEventListener('change', async () => {
                sub.isShowing = checkbox.checked;
                renderTable();
                await updateSubmissionOnServer(sub.id, { is_showing: sub.isShowing });
                if (isSlideshowRunning) updateSlideshowList(); // 再生リスト即時更新
            });

            const slider = document.createElement('span');
            slider.classList.add('slider');

            switchLabel.appendChild(checkbox);
            switchLabel.appendChild(slider);
            toggleWrapper.appendChild(switchLabel);
            toggleWrapper.appendChild(labelToggleText);
            tdToggle.appendChild(toggleWrapper);
            tr.appendChild(tdToggle);

            // 操作
            const tdAction = document.createElement('td');
            const actionRow = document.createElement('div');
            actionRow.classList.add('action-buttons-row');

            // プレビューボタン
            const btnPrev = document.createElement('button');
            btnPrev.classList.add('btn-table-preview');
            btnPrev.innerHTML = '👁️ プレビュー';
            btnPrev.addEventListener('click', () => showPreview(sub));

            // 手動表示ボタン
            const btnShow = document.createElement('button');
            btnShow.classList.add('btn-table-show');
            btnShow.innerHTML = '▶ 手動で表示';
            btnShow.addEventListener('click', () => showOnLED(sub, false));

            // 削除ボタン
            const btnDel = document.createElement('button');
            btnDel.classList.add('btn-table-delete');
            btnDel.innerHTML = '🗑️ 削除';
            btnDel.addEventListener('click', () => showDeleteConfirm(sub));

            actionRow.appendChild(btnPrev);
            actionRow.appendChild(btnShow);
            actionRow.appendChild(btnDel);
            tdAction.appendChild(actionRow);
            tr.appendChild(tdAction);

            submissionsTbody.appendChild(tr);
        });
    }

    // --- 各アクション処理 ---

    // プレビューモーダル開く
    async function showPreview(sub) {
        txtModalPreviewTitle.textContent = `作品プレビュー (ID: ${sub.id})`;
        txtPreviewNickname.textContent = sub.nickname;
        txtPreviewTime.textContent = sub.timestamp;
        if (txtPreviewSize) {
            txtPreviewSize.textContent = `${sub.width}×${sub.height}ドット`;
        }

        // プレビューグリッドの描画
        drawPixelGrid(modalPreviewCanvas, sub.pixels, sub.width, sub.height);

        // NEWフラグを落とす
        if (sub.isNew) {
            sub.isNew = false;
            renderTable();
            await updateSubmissionOnServer(sub.id, { is_new: false });
        }

        modalPreview.classList.remove('hidden');
    }

    // 削除確認モーダル開く
    function showDeleteConfirm(sub) {
        pendingDeleteId = sub.id;
        txtModalDeleteTitle.textContent = `削除確認 (ID: ${sub.id})`;
        txtDeleteNickname.textContent = sub.nickname;
        txtDeleteTime.textContent = sub.timestamp;

        drawPixelGrid(modalDeleteThumbnail, sub.pixels, sub.width, sub.height);

        modalDelete.classList.remove('hidden');
    }

    // 削除実行
    btnDeleteConfirm.addEventListener('click', async () => {
        if (pendingDeleteId !== null) {
            const deletedId = pendingDeleteId;

            currentSubmissions = currentSubmissions.filter(sub => sub.id !== deletedId);
            renderTable();

            await deleteSubmissionOnServer(deletedId);

            // 現在LEDに表示中の作品が削除されたらリセット
            if (activeLedSubmissionId === deletedId) {
                resetLEDDisplay();
            }

            // スライドショーの更新
            if (isSlideshowRunning) {
                updateSlideshowList();
            }

            modalDelete.classList.add('hidden');
            pendingDeleteId = null;
        }
    });

    // モーダルを閉じる
    function closeModals() {
        modalPreview.classList.add('hidden');
        modalDelete.classList.add('hidden');
        pendingDeleteId = null;
    }

    btnClosePreviewModal.addEventListener('click', closeModals);
    btnPreviewClose.addEventListener('click', closeModals);
    btnCloseDeleteModal.addEventListener('click', closeModals);
    btnDeleteCancel.addEventListener('click', closeModals);

    // フィルターの切り替え
    btnFilters.forEach(btn => {
        btn.addEventListener('click', () => {
            btnFilters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            renderTable();
        });
    });

    // 検索入力の監視
    inputSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderTable();
    });

    // 手動リフレッシュ（サーバーから最新データを再取得）
    btnRefresh.addEventListener('click', async () => {
        await Promise.all([loadData(), updateConnectionStatus()]);
        renderTable();
        updateSlideshowList();
    });

    // --- LEDシミュレーション表示 ---
    let activeLedSubmissionId = null;

    async function sendToLed(sub) {
        const res = await fetch(`${API_BASE}/display/${sub.id}?width=5&height=5`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function showOnLED(sub, isFromSlideshow = false) {
        activeLedSubmissionId = sub.id;

        // 右上プレビューへのドット絵描画
        drawPixelGrid(ledPreviewCanvas, sub.pixels, sub.width, sub.height);

        // 詳細テキストの更新
        displayInfoDetail.innerHTML = `
            <p><strong>ID:</strong> <span class="highlight">${sub.id}</span></p>
            <p><strong>ニックネーム:</strong> <span class="highlight">${sub.nickname}</span></p>
            <p><strong>表示方式:</strong> <span class="highlight">${isFromSlideshow ? '自動（スライドショー）' : '手動選択'}</span></p>
        `;

        try {
            const data = await sendToLed(sub);
            console.log(`[LED] ID:${sub.id}をESP32用表示データに設定しました。`, data.display);
        } catch (e) {
            console.error('[LED] 表示データの送信に失敗しました:', e);
            displayInfoDetail.innerHTML += `
                <p style="color:#ef4444;"><strong>LED送信:</strong> サーバーへの表示指示に失敗しました。</p>
            `;
        }
    }

    function resetLEDDisplay() {
        activeLedSubmissionId = null;
        ledPreviewCanvas.innerHTML = '';
        displayInfoDetail.innerHTML = `
            <p class="info-empty-msg">手動表示またはスライドショー開始でここに表示されます</p>
        `;
    }

    // --- スライドショー制御ロジック ---

    function updateSlideshowList() {
        const count = parseInt(selectCount.value, 10);

        // 1. ピン留めされている作品（表示対象に限る）
        const pinnedList = currentSubmissions.filter(sub => sub.isPinned && sub.isShowing);
        // PinnedはID降順（新しい順）にしておく
        pinnedList.sort((a, b) => b.id - a.id);

        // 2. ピン留めされていない表示対象作品（最新順）
        const normalList = currentSubmissions.filter(sub => !sub.isPinned && sub.isShowing);
        normalList.sort((a, b) => b.id - a.id);

        // 優先順位で結合: ピン留め ➡ 最新の対象
        const mergedList = [...pinnedList, ...normalList];

        // 設定された表示件数で切り出し
        slideshowList = mergedList.slice(0, count);

        // スライドショー表示設定エリアのインジケーターテキスト更新
        const configMsgText = document.querySelector('.config-msg-text');
        if (configMsgText) {
            configMsgText.textContent = `スライドショーは「ピン留め${pinnedList.length}件 ＋ スライドショー対象（最新から${Math.max(0, slideshowList.length - pinnedList.length)}件）」の合計${slideshowList.length}件で構成されます。`;
        }
    }

    function playNextInSlideshow() {
        if (slideshowList.length === 0) {
            displayInfoDetail.innerHTML = `<p class="info-empty-msg" style="color: #ef4444;">エラー: 表示対象の作品がありません。「スライドショー対象」をONにするかピン留めを設定してください。</p>`;
            return;
        }

        slideshowIndex = (slideshowIndex + 1) % slideshowList.length;
        const currentSub = slideshowList[slideshowIndex];

        showOnLED(currentSub, true);

        // スライドショーの現在状況をサブ表示
        badgeSlideshowStatus.textContent = `再生中 (${slideshowIndex + 1}/${slideshowList.length})`;
    }

    function startSlideshow() {
        if (isSlideshowRunning) stopSlideshow();

        isSlideshowRunning = true;
        badgeSlideshowStatus.className = 'badge-status-active';
        badgeSlideshowStatus.textContent = '再生中';
        btnSlideshowStart.style.opacity = '0.7';
        btnSlideshowStart.disabled = true;

        updateSlideshowList();

        // すぐに最初の1件目を再生
        slideshowIndex = -1;
        playNextInSlideshow();

        // 指定間隔でループ実行
        const seconds = parseInt(selectInterval.value, 10);
        slideshowTimer = setInterval(() => {
            playNextInSlideshow();
        }, seconds * 1000);
    }

    function stopSlideshow() {
        isSlideshowRunning = false;
        if (slideshowTimer) {
            clearInterval(slideshowTimer);
            slideshowTimer = null;
        }

        badgeSlideshowStatus.className = 'badge-status-inactive';
        badgeSlideshowStatus.textContent = '停止中';
        btnSlideshowStart.style.opacity = '1';
        btnSlideshowStart.disabled = false;
    }

    btnSlideshowStart.addEventListener('click', startSlideshow);
    btnSlideshowStop.addEventListener('click', stopSlideshow);

    // 設定変更時の即時反映
    selectInterval.addEventListener('change', () => {
        if (isSlideshowRunning) {
            startSlideshow(); // 再起動してインターバル時間を変更
        }
    });

    selectCount.addEventListener('change', () => {
        updateSlideshowList();
        if (isSlideshowRunning) {
            // スライドショー再生対象の再計算
            slideshowIndex = -1;
            playNextInSlideshow();
        }
    });

    // --- 接続テスト（サーバーの疎通確認） ---
    btnTestConnection.addEventListener('click', async () => {
        btnTestConnection.disabled = true;
        btnTestConnection.textContent = 'テスト中...';

        try {
            const res = await fetch(`${API_BASE}/`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            console.log('[接続テスター] サーバーへの通信に成功しました。');
            alert(`接続テストに成功しました！\nサーバー(${API_BASE})との通信は正常です。\n※ESP32実機との通信は別途確認してください。`);
        } catch (e) {
            console.error('[接続テスター] 通信に失敗しました:', e);
            alert(`接続テストに失敗しました。\nserver.js(${API_BASE})が起動しているか確認してください。`);
        } finally {
            btnTestConnection.disabled = false;
            btnTestConnection.textContent = '接続テスト';
        }
    });

    // --- 初回ロード ＆ 描画（サーバーから取得） ---
    (async () => {
        await Promise.all([loadData(), updateConnectionStatus()]);
        renderTable();
        updateSlideshowList(); // 最初の説明枠メッセージを更新
    })();

    setInterval(() => {
        updateConnectionStatus();
    }, 5000);
});

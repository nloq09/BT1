/**
 * ui/board.js — Render bàn cờ, xử lý click/highlight
 * Phụ thuộc vào core/game.js nhưng KHÔNG đụng mạng.
 */

import {
  PIECE_EMOJI, PIECE_NAME, PLAYER, getLegalMoves, toChessNotation
} from '../core/game.js';

// ── State cục bộ của UI ───────────────────────────────────────────────────────
let _container = null;
let _onMoveCallback = null;
let _selectedCell = null;   // { row, col } | null
let _legalMoves = [];        // [{ row, col, captures }]
let _currentState = null;
let _myPlayer = null;

// ── Khởi tạo ─────────────────────────────────────────────────────────────────

/**
 * Khởi tạo UI board.
 * @param {HTMLElement} containerEl - div chứa bàn cờ
 * @param {Function} onMoveCallback - gọi khi người chơi xác nhận nước đi
 *   Signature: onMoveCallback(fromRow, fromCol, toRow, toCol)
 */
export function initBoard(containerEl, onMoveCallback) {
  _container = containerEl;
  _onMoveCallback = onMoveCallback;

  // Tạo khung rỗng, nội dung nhãn và grid sẽ render theo perspective trong renderBoard
  _container.innerHTML = `
    <div class="board-wrapper">
      <div class="col-labels" id="col-labels"></div>
      <div class="board-grid" id="board-grid"></div>
      <div class="row-labels" id="row-labels"></div>
    </div>
  `;
}

// ── Render chính ──────────────────────────────────────────────────────────────

/**
 * Vẽ lại toàn bộ bàn cờ từ state theo góc nhìn của người chơi.
 * Luật góc nhìn: Quân của mình luôn ở phía DƯỚI, Quân địch luôn ở phía TRÊN.
 *
 * @param {GameState} state
 * @param {string} myPlayer - 'A' | 'B' | null (spectator)
 */
export function renderBoard(state, myPlayer) {
  _currentState = state;
  _myPlayer = myPlayer;

  const grid = document.getElementById('board-grid');
  const colLabelsEl = document.getElementById('col-labels');
  const rowLabelsEl = document.getElementById('row-labels');
  if (!grid || !colLabelsEl || !rowLabelsEl) return;

  grid.innerHTML = '';

  // Nếu không phải lượt của mình → bỏ selection
  if (state.turn !== myPlayer) {
    _selectedCell = null;
    _legalMoves = [];
  }

  // Re-compute legal moves nếu đang có ô được chọn
  if (_selectedCell) {
    _legalMoves = getLegalMoves(state.board, _selectedCell.row, _selectedCell.col);
  }

  // Xác định thứ tự hiển thị hàng/cột theo góc nhìn:
  // Phe B: lật ngược 180 độ (B ở dưới rank 9..1, cột i..a) để A (địch) ở trên
  // Phe A / Spectator: A ở dưới (rank 1..9, cột a..i) để B (địch) ở trên
  const isPlayerB = myPlayer === 'B';
  const rowIndices = isPlayerB ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const colIndices = isPlayerB ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];

  // Render nhãn cột và hàng
  colLabelsEl.innerHTML = colIndices
    .map(c => `<div class="label">${'abcdefghi'[c]}</div>`)
    .join('');
  rowLabelsEl.innerHTML = rowIndices
    .map(r => `<div class="label">${r + 1}</div>`)
    .join('');

  // Render các ô bàn cờ
  for (const row of rowIndices) {
    for (const col of colIndices) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;

      // Màu nền ô bàn cờ (checkerboard)
      const isDark = (row + col) % 2 === 1;
      cell.classList.add(isDark ? 'cell-dark' : 'cell-light');

      // Ô đích
      if (row === 8 && col === 8) cell.classList.add('goal-a');
      if (row === 0 && col === 0) cell.classList.add('goal-b');

      // Ô đang chọn
      if (_selectedCell && _selectedCell.row === row && _selectedCell.col === col) {
        cell.classList.add('selected');
      }

      // Ô có thể đi đến
      const legalMove = _legalMoves.find(m => m.row === row && m.col === col);
      if (legalMove) {
        cell.classList.add(legalMove.captures ? 'can-capture' : 'can-move');
      }

      // Quân cờ
      const piece = state.board[row][col];
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece piece-${piece.player.toLowerCase()}`;
        pieceEl.textContent = PIECE_EMOJI[piece.type];
        pieceEl.title = `${PIECE_NAME[piece.type]} - Phe ${piece.player === PLAYER.A ? 'Đỏ' : 'Xanh'}`;
        cell.appendChild(pieceEl);
      }

      // Tooltip tên ô
      cell.title = (cell.title ? cell.title + ' — ' : '') + toChessNotation(row, col);

      // Click handler
      cell.addEventListener('click', () => _handleCellClick(row, col, state, myPlayer));

      grid.appendChild(cell);
    }
  }
}

// ── Click handler ─────────────────────────────────────────────────────────────

function _handleCellClick(row, col, state, myPlayer) {
  // Spectator hoặc game đã kết thúc → không làm gì
  if (!myPlayer || state.winner !== null) return;

  // Không phải lượt của mình
  if (state.turn !== myPlayer) {
    showNotification('Không phải lượt của bạn!', 'warn');
    return;
  }

  const piece = state.board[row][col];

  // Đang có ô được chọn → thử di chuyển
  if (_selectedCell) {
    const move = _legalMoves.find(m => m.row === row && m.col === col);
    if (move) {
      // Hợp lệ → gọi callback
      _onMoveCallback(_selectedCell.row, _selectedCell.col, row, col);
      _selectedCell = null;
      _legalMoves = [];
      return;
    }

    // Click vào quân của mình → chọn quân mới
    if (piece && piece.player === myPlayer) {
      _selectedCell = { row, col };
      _legalMoves = getLegalMoves(state.board, row, col);
      renderBoard(state, myPlayer);
      return;
    }

    // Click vào chỗ không hợp lệ → bỏ chọn
    _selectedCell = null;
    _legalMoves = [];
    renderBoard(state, myPlayer);
    return;
  }

  // Chưa chọn ô → chọn quân của mình
  if (piece && piece.player === myPlayer) {
    _selectedCell = { row, col };
    _legalMoves = getLegalMoves(state.board, row, col);

    if (_legalMoves.length === 0) {
      showNotification('Quân này không có nước đi!', 'info');
      _selectedCell = null;
    }
    renderBoard(state, myPlayer);
  }
}

// ── Thông báo ─────────────────────────────────────────────────────────────────

/**
 * Hiển thị thông báo nổi (toast).
 * @param {string} message
 * @param {'info'|'warn'|'success'|'error'} type
 * @param {number} duration ms
 */
export function showNotification(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  const container = document.getElementById('toast-container');
  if (!container) return;
  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ── Render thông tin phụ ─────────────────────────────────────────────────────

/**
 * Cập nhật bảng trạng thái (lượt đi, số quân, người chơi online).
 * @param {GameState} state
 * @param {string} myPlayer
 * @param {{ playerA: boolean, playerB: boolean }} presence
 */
export function renderStatus(state, myPlayer, presence) {
  const el = document.getElementById('status-bar');
  if (!el) return;

  const isMyTurn = state.turn === myPlayer;
  const turnLabel = state.turn === PLAYER.A ? '🔴 Đỏ' : '🔵 Xanh';

  // Đếm quân
  const countPieces = (player) => {
    const counts = { H: 0, S: 0, P: 0 };
    for (const row of state.board) {
      for (const cell of row) {
        if (cell && cell.player === player) counts[cell.type]++;
      }
    }
    return counts;
  };
  const cntA = countPieces('A');
  const cntB = countPieces('B');

  const presenceHtml = `
    <span class="presence ${presence?.playerA ? 'online' : 'offline'}">🔴 ${presence?.playerA ? 'Online' : 'Chờ...'}</span>
    <span class="presence ${presence?.playerB ? 'online' : 'offline'}">🔵 ${presence?.playerB ? 'Online' : 'Chờ...'}</span>
  `;

  el.innerHTML = `
    <div class="status-turn ${isMyTurn ? 'my-turn' : ''}">
      ${state.winner
        ? `<strong>🏆 ${state.winner === myPlayer ? 'BẠN THẮNG! 🎉' : 'BẠN THUA!'}</strong><br><small>${state.reason}</small>`
        : `Lượt: <strong>${turnLabel}</strong> ${isMyTurn ? '← <em>lượt bạn</em>' : ''}`
      }
    </div>
    <div class="status-pieces">
      <div class="pieces-a">🔴 ${PIECE_EMOJI.H}×${cntA.H} ${PIECE_EMOJI.S}×${cntA.S} ${PIECE_EMOJI.P}×${cntA.P}</div>
      <div class="pieces-b">🔵 ${PIECE_EMOJI.H}×${cntB.H} ${PIECE_EMOJI.S}×${cntB.S} ${PIECE_EMOJI.P}×${cntB.P}</div>
    </div>
    <div class="status-presence">${presenceHtml}</div>
  `;
}

/**
 * Render mini bàn cờ cho spectator (CSS grid đơn giản).
 * @param {Cell[][]} board
 * @param {string} turn
 * @param {HTMLElement} container
 */
export function renderMiniBoard(board, turn, container) {
  container.innerHTML = '';
  container.className = 'mini-board';

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = 'mini-cell';
      const isDark = (r + c) % 2 === 1;
      cell.classList.add(isDark ? 'mini-dark' : 'mini-light');
      if (r === 8 && c === 8) cell.classList.add('mini-goal-a');
      if (r === 0 && c === 0) cell.classList.add('mini-goal-b');

      const piece = board[r][c];
      if (piece) {
        const pieceSpan = document.createElement('span');
        pieceSpan.className = `mini-piece mini-piece-${piece.player.toLowerCase()}`;
        pieceSpan.textContent = PIECE_EMOJI[piece.type];
        cell.appendChild(pieceSpan);
      }
      container.appendChild(cell);
    }
  }
}

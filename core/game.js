/**
 * core/game.js — Logic thuần túy cho game Oẳn Tù Tì v2
 * Không có DOM, không có mạng — có thể test độc lập.
 *
 * Bàn cờ 9x9:
 *   Cột: a(0) → i(8)
 *   Hàng: 1(0) → 9(8)
 *   board[row][col] = null | { type, player }
 *
 * Phe A (đỏ): xuất phát góc a1 = [0][0]
 * Phe B (xanh): xuất phát góc i9 = [8][8]
 *
 * Ô đích:
 *   A → phải đến i9 = [8][8]
 *   B → phải đến a1 = [0][0]
 */

// ── Hằng số ──────────────────────────────────────────────────────────────────

export const PIECE = { H: 'H', S: 'S', P: 'P' }; // Hammer, Scissors, Paper
export const PLAYER = { A: 'A', B: 'B' };
export const PIECE_EMOJI = { H: '🥊', S: '✂️', P: '📄' };
export const PIECE_NAME = { H: 'Búa', S: 'Kéo', P: 'Bao' };

/**
 * Quan hệ thắng: BEATS[x] = y  nghĩa là  x thắng y
 * H > S > P > H
 */
export const BEATS = { H: 'S', S: 'P', P: 'H' };

const BOARD_SIZE = 9;

// 8 hướng di chuyển (king-move)
const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

// ── Vị trí xuất phát ─────────────────────────────────────────────────────────

/**
 * Tạo danh sách ô xuất phát cho phe A (góc a1 = [0][0]).
 * 3x3 block tại góc trên-trái, xếp theo thứ tự H, H, H, S, S, S, P, P, P
 */
function _getStartPositionsA() {
  // 9 ô: (0,0),(0,1),(0,2),(1,0),(1,1),(1,2),(2,0),(2,1),(2,2)
  const types = ['H','H','H','S','S','S','P','P','P'];
  const positions = [];
  let i = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      positions.push({ row: r, col: c, type: types[i++] });
    }
  }
  return positions;
}

/**
 * Tạo danh sách ô xuất phát cho phe B — đối xứng qua tâm (4,4).
 * Đối xứng điểm: (r,c) → (8-r, 8-c)
 */
function _getStartPositionsB() {
  return _getStartPositionsA().map(({ row, col, type }) => ({
    row: 8 - row,
    col: 8 - col,
    type,
  }));
}

// ── Khởi tạo bàn cờ ──────────────────────────────────────────────────────────

/**
 * Tạo state ban đầu của game.
 * @returns {GameState}
 */
export function createInitialBoard() {
  // board[row][col] = null | { type: 'H'|'S'|'P', player: 'A'|'B' }
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(null)
  );

  for (const { row, col, type } of _getStartPositionsA()) {
    board[row][col] = { type, player: PLAYER.A };
  }
  for (const { row, col, type } of _getStartPositionsB()) {
    board[row][col] = { type, player: PLAYER.B };
  }

  return {
    board,
    turn: PLAYER.A,       // Phe A đi trước
    winner: null,          // null | 'A' | 'B'
    reason: null,          // string
    capturedTypes: {       // Các loại quân đã bị ăn sạch
      A: [],               // loại quân của A đã bị ăn sạch (bởi B)
      B: [],               // loại quân của B đã bị ăn sạch (bởi A)
    },
    moveHistory: [],       // [{fromRow, fromCol, toRow, toCol, player, captured}]
    rematchVotes: { A: false, B: false }, // Trạng thái đồng ý chơi lại từ 2 bên
    joinedPlayers: { A: false, B: false }, // Trạng thái 2 người chơi đã vào phòng
  };
}

// ── Logic di chuyển ───────────────────────────────────────────────────────────

/**
 * Trả về true nếu [row,col] nằm trong bàn cờ.
 */
function _inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/**
 * Kiểm tra quân tại [row][col] có cùng loại với quân được chọn không.
 * Nếu cùng loại → chặn đường (không được đi vào), dù cùng phe hay khác phe.
 */
function _isSameType(board, row, col, pieceType) {
  const cell = board[row][col];
  return cell !== null && cell.type === pieceType;
}

/**
 * Tính toán các nước đi hợp lệ từ ô [fromRow][fromCol].
 *
 * Luật:
 * - Di chuyển đúng 1 ô theo 8 hướng
 * - Không ra ngoài bàn cờ
 * - Không đi vào ô có quân cùng loại (kể cả của đối phương)
 * - Không đi vào ô đối phương mà đối phương thắng mình (no suicide)
 *
 * @param {Cell[][]} board
 * @param {number} fromRow
 * @param {number} fromCol
 * @returns {Array<{row: number, col: number, captures: boolean}>}
 */
export function getLegalMoves(board, fromRow, fromCol) {
  const piece = board[fromRow][fromCol];
  if (!piece) return [];

  const moves = [];

  for (const [dr, dc] of DIRECTIONS) {
    const toRow = fromRow + dr;
    const toCol = fromCol + dc;

    if (!_inBounds(toRow, toCol)) continue;

    const target = board[toRow][toCol];

    if (target === null) {
      // Ô trống → được đi
      moves.push({ row: toRow, col: toCol, captures: false });
      continue;
    }

    if (target.type === piece.type) {
      // Cùng loại (bất kể phe) → BỊ CHẶN
      continue;
    }

    if (target.player === piece.player) {
      // Quân của mình nhưng khác loại → BỊ CHẶN
      // (Không thể đi vào ô có quân cùng phe — dù khác loại)
      continue;
    }

    // target.player !== piece.player và khác loại → quân đối phương
    if (BEATS[piece.type] === target.type) {
      // Mình thắng đối phương → ĂN được
      moves.push({ row: toRow, col: toCol, captures: true });
    }
    // Ngược lại (đối phương thắng mình) → KHÔNG được đi (suicide)
  }

  return moves;
}

// ── Áp dụng nước đi ──────────────────────────────────────────────────────────

/**
 * Áp dụng nước đi, trả về state mới (immutable — không sửa state cũ).
 * Hàm này KHÔNG validate nước đi — gọi getLegalMoves trước để kiểm tra.
 *
 * @param {GameState} state
 * @param {number} fromRow
 * @param {number} fromCol
 * @param {number} toRow
 * @param {number} toCol
 * @returns {GameState}
 */
export function applyMove(state, fromRow, fromCol, toRow, toCol) {
  // Deep clone board
  const newBoard = state.board.map(row => row.map(cell =>
    cell ? { ...cell } : null
  ));

  const piece = newBoard[fromRow][fromCol];
  const target = newBoard[toRow][toCol];

  // Theo dõi quân bị ăn
  let capturedType = null;
  let capturedPlayer = null;

  if (target !== null) {
    capturedType = target.type;
    capturedPlayer = target.player;
  }

  // Di chuyển quân
  newBoard[toRow][toCol] = piece;
  newBoard[fromRow][fromCol] = null;

  // Cập nhật capturedTypes
  const newCapturedTypes = {
    A: [...state.capturedTypes.A],
    B: [...state.capturedTypes.B],
  };

  if (capturedPlayer !== null) {
    // Kiểm tra xem tất cả quân loại đó của phe capturedPlayer còn không
    const remainingOfType = newBoard.flat().filter(
      c => c && c.player === capturedPlayer && c.type === capturedType
    );
    if (remainingOfType.length === 0) {
      // Đã ăn sạch loại đó
      if (!newCapturedTypes[capturedPlayer].includes(capturedType)) {
        newCapturedTypes[capturedPlayer] = [...newCapturedTypes[capturedPlayer], capturedType];
      }
    }
  }

  // Lịch sử nước đi
  const moveRecord = {
    fromRow, fromCol, toRow, toCol,
    player: piece.player,
    captured: capturedType ? { type: capturedType, player: capturedPlayer } : null,
  };

  const newHistory = [...state.moveHistory, moveRecord];

  // Chuyển lượt
  const nextTurn = state.turn === PLAYER.A ? PLAYER.B : PLAYER.A;

  const newState = {
    board: newBoard,
    turn: nextTurn,
    winner: null,
    reason: null,
    capturedTypes: newCapturedTypes,
    moveHistory: newHistory,
    rematchVotes: { A: false, B: false },
    joinedPlayers: state.joinedPlayers || { A: true, B: true },
  };

  // Kiểm tra thắng ngay sau nước đi
  const result = isGameOver(newState, { lastMoved: piece, toRow, toCol, movedPlayer: piece.player });
  if (result.over) {
    newState.winner = result.winner;
    newState.reason = result.reason;
  }

  return newState;
}

// ── Kiểm tra thắng/thua ───────────────────────────────────────────────────────

/**
 * Ô đích của từng phe:
 *   Phe A phải đến i9 = [8][8]
 *   Phe B phải đến a1 = [0][0]
 */
export function isGoalSquare(row, col, player) {
  if (player === PLAYER.A) return row === 8 && col === 8;
  if (player === PLAYER.B) return row === 0 && col === 0;
  return false;
}

/**
 * Kiểm tra game có kết thúc chưa.
 *
 * @param {GameState} state
 * @param {{lastMoved, toRow, toCol, movedPlayer}} [hint] — gợi ý từ applyMove
 * @returns {{ over: boolean, winner: string|null, reason: string }}
 */
export function isGameOver(state, hint = null) {
  const { board, turn } = state;

  // 1. Kiểm tra ô đích (chỉ cần xét nước vừa đi nếu có hint)
  if (hint) {
    const { toRow, toCol, movedPlayer } = hint;
    if (isGoalSquare(toRow, toCol, movedPlayer)) {
      return {
        over: true,
        winner: movedPlayer,
        reason: `Phe ${movedPlayer === PLAYER.A ? '🔴 Đỏ' : '🔵 Xanh'} đã đưa quân về ô đích!`,
      };
    }
  } else {
    // Không có hint → quét toàn bộ bàn
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = board[r][c];
        if (cell && isGoalSquare(r, c, cell.player)) {
          return {
            over: true,
            winner: cell.player,
            reason: `Phe ${cell.player === PLAYER.A ? '🔴 Đỏ' : '🔵 Xanh'} đã đưa quân về ô đích!`,
          };
        }
      }
    }
  }

  // 2. Kiểm tra ăn sạch TẤT CẢ các quân của đối thủ
  let countA = 0;
  let countB = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell) {
        if (cell.player === PLAYER.A) countA++;
        else if (cell.player === PLAYER.B) countB++;
      }
    }
  }

  if (countB === 0) {
    return {
      over: true,
      winner: PLAYER.A,
      reason: 'Phe 🔴 Đỏ đã ăn sạch toàn bộ quân của đối thủ!',
    };
  }

  if (countA === 0) {
    return {
      over: true,
      winner: PLAYER.B,
      reason: 'Phe 🔵 Xanh đã ăn sạch toàn bộ quân của đối thủ!',
    };
  }

  // 3. Kiểm tra người chơi hiện tại có nước đi không
  const currentPlayer = turn;
  let hasAnyMove = false;
  outer:
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell && cell.player === currentPlayer) {
        const moves = getLegalMoves(board, r, c);
        if (moves.length > 0) {
          hasAnyMove = true;
          break outer;
        }
      }
    }
  }

  if (!hasAnyMove) {
    const winner = currentPlayer === PLAYER.A ? PLAYER.B : PLAYER.A;
    return {
      over: true,
      winner,
      reason: `Phe ${currentPlayer === PLAYER.A ? '🔴 Đỏ' : '🔵 Xanh'} không còn nước đi hợp lệ!`,
    };
  }

  return { over: false, winner: null, reason: '' };
}

// ── Helper utilities ──────────────────────────────────────────────────────────

/**
 * Đếm số quân mỗi loại của một phe trên bàn.
 * @param {Cell[][]} board
 * @param {string} player
 * @returns {{ H: number, S: number, P: number }}
 */
export function countPieces(board, player) {
  const count = { H: 0, S: 0, P: 0 };
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.player === player) {
        count[cell.type]++;
      }
    }
  }
  return count;
}

/**
 * Chuyển [row, col] sang ký hiệu cờ vua (ví dụ: a1, i9).
 */
export function toChessNotation(row, col) {
  const col_letter = 'abcdefghi'[col];
  const row_num = row + 1;
  return `${col_letter}${row_num}`;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

/**
 * Chạy toàn bộ test cases.
 * Gọi trong browser console: import('core/game.js').then(m => m.runTests())
 */
export function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  console.group('🧪 OTTv2 Core Tests');

  // ── Test 1: Tạo bàn cờ ban đầu ────────────────────────────────────────────
  console.group('Test 1: createInitialBoard');
  const state0 = createInitialBoard();
  assert(state0.board.length === 9, 'Board có 9 hàng');
  assert(state0.board[0].length === 9, 'Mỗi hàng có 9 cột');
  assert(state0.turn === 'A', 'Lượt đầu là phe A');
  assert(state0.winner === null, 'Chưa có winner');

  const cntA = countPieces(state0.board, 'A');
  const cntB = countPieces(state0.board, 'B');
  assert(cntA.H === 3 && cntA.S === 3 && cntA.P === 3, 'Phe A có 3H+3S+3P');
  assert(cntB.H === 3 && cntB.S === 3 && cntB.P === 3, 'Phe B có 3H+3S+3P');

  // Kiểm tra đối xứng
  assert(state0.board[0][0] !== null && state0.board[0][0].player === 'A', 'A có quân ở [0][0]');
  assert(state0.board[8][8] !== null && state0.board[8][8].player === 'B', 'B có quân ở [8][8]');

  const cellA = state0.board[0][0];
  const cellB = state0.board[8][8];
  assert(cellA.type === cellB.type, 'Quân đầu tiên đối xứng cùng loại');
  console.groupEnd();

  // ── Test 2: Búa ăn Kéo ────────────────────────────────────────────────────
  console.group('Test 2: Búa ăn Kéo');
  const board2 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board2[4][4] = { type: 'H', player: 'A' }; // Búa A ở giữa
  board2[4][5] = { type: 'S', player: 'B' }; // Kéo B bên phải

  const moves2 = getLegalMoves(board2, 4, 4);
  const canEat = moves2.some(m => m.row === 4 && m.col === 5 && m.captures);
  assert(canEat, 'Búa A có thể ăn Kéo B ở [4][5]');
  console.groupEnd();

  // ── Test 3: Kéo ăn Bao ────────────────────────────────────────────────────
  console.group('Test 3: Kéo ăn Bao');
  const board3 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board3[3][3] = { type: 'S', player: 'B' };
  board3[3][4] = { type: 'P', player: 'A' };

  const moves3 = getLegalMoves(board3, 3, 3);
  const canEat3 = moves3.some(m => m.row === 3 && m.col === 4 && m.captures);
  assert(canEat3, 'Kéo B có thể ăn Bao A ở [3][4]');
  console.groupEnd();

  // ── Test 4: Bao ăn Búa ────────────────────────────────────────────────────
  console.group('Test 4: Bao ăn Búa');
  const board4 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board4[5][5] = { type: 'P', player: 'A' };
  board4[5][6] = { type: 'H', player: 'B' };

  const moves4 = getLegalMoves(board4, 5, 5);
  const canEat4 = moves4.some(m => m.row === 5 && m.col === 6 && m.captures);
  assert(canEat4, 'Bao A có thể ăn Búa B ở [5][6]');
  console.groupEnd();

  // ── Test 5: Cùng loại chặn nhau (không ăn được) ───────────────────────────
  console.group('Test 5: Cùng loại chặn nhau');
  const board5 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board5[2][2] = { type: 'H', player: 'A' }; // Búa A
  board5[2][3] = { type: 'H', player: 'B' }; // Búa B

  const moves5 = getLegalMoves(board5, 2, 2);
  const cantGo = !moves5.some(m => m.row === 2 && m.col === 3);
  assert(cantGo, 'Búa A KHÔNG thể đi vào ô có Búa B (cùng loại)');

  // Cùng phe cùng loại
  const board5b = Array.from({ length: 9 }, () => Array(9).fill(null));
  board5b[2][2] = { type: 'H', player: 'A' };
  board5b[2][3] = { type: 'H', player: 'A' };
  const moves5b = getLegalMoves(board5b, 2, 2);
  const cantGo5b = !moves5b.some(m => m.row === 2 && m.col === 3);
  assert(cantGo5b, 'Búa A KHÔNG thể đi vào ô có Búa A (cùng loại cùng phe)');
  console.groupEnd();

  // ── Test 6: Không tự sát ──────────────────────────────────────────────────
  console.group('Test 6: Không tự sát (suicide)');
  const board6 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board6[4][4] = { type: 'S', player: 'A' }; // Kéo A
  board6[4][5] = { type: 'H', player: 'B' }; // Búa B (thắng Kéo)

  const moves6 = getLegalMoves(board6, 4, 4);
  const noSuicide = !moves6.some(m => m.row === 4 && m.col === 5);
  assert(noSuicide, 'Kéo A KHÔNG thể đi vào ô có Búa B (Búa thắng Kéo)');
  console.groupEnd();

  // ── Test 7: Không thể đi vào ô quân cùng phe (khác loại) ─────────────────
  console.group('Test 7: Không thể đi vào quân cùng phe');
  const board7 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board7[4][4] = { type: 'H', player: 'A' }; // Búa A
  board7[4][5] = { type: 'S', player: 'A' }; // Kéo A (cùng phe)

  const moves7 = getLegalMoves(board7, 4, 4);
  const blocked7 = !moves7.some(m => m.row === 4 && m.col === 5);
  assert(blocked7, 'Búa A KHÔNG thể đi vào ô có Kéo A (cùng phe)');
  console.groupEnd();

  // ── Test 8: applyMove — ăn quân ───────────────────────────────────────────
  console.group('Test 8: applyMove ăn quân');
  const board8 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board8[4][4] = { type: 'H', player: 'A' };
  board8[4][5] = { type: 'S', player: 'B' };
  const state8 = { board: board8, turn: 'A', winner: null, reason: null, capturedTypes: { A: [], B: [] }, moveHistory: [] };
  const state8b = applyMove(state8, 4, 4, 4, 5);

  assert(state8b.board[4][5] !== null && state8b.board[4][5].type === 'H' && state8b.board[4][5].player === 'A', 'Búa A chiếm ô [4][5]');
  assert(state8b.board[4][4] === null, 'Ô [4][4] trống sau khi đi');
  assert(state8b.turn === 'B', 'Lượt chuyển sang B');
  console.groupEnd();

  // ── Test 9: Thắng bằng ăn sạch tất cả quân đối thủ ───────────────────────
  console.group('Test 9: Thắng bằng ăn sạch tất cả quân');
  // B chỉ còn đúng 1 quân duy nhất ở [0][1], A đưa Búa đến ăn
  const board9 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board9[0][0] = { type: 'H', player: 'A' };
  board9[0][1] = { type: 'S', player: 'B' }; // Quân B duy nhất trên bàn

  const state9 = { board: board9, turn: 'A', winner: null, reason: null, capturedTypes: { A: [], B: [] }, moveHistory: [] };
  const state9b = applyMove(state9, 0, 0, 0, 1);

  assert(state9b.winner === 'A', 'Phe A thắng khi ăn sạch toàn bộ quân của B');
  console.groupEnd();

  // ── Test 10: Thắng bằng vào ô đích ───────────────────────────────────────
  console.group('Test 10: Thắng bằng vào ô đích');
  const board10 = Array.from({ length: 9 }, () => Array(9).fill(null));
  board10[7][8] = { type: 'H', player: 'A' }; // A gần ô đích [8][8]
  board10[0][0] = { type: 'H', player: 'B' }; // B còn quân (để game chưa kết thúc)

  const state10 = { board: board10, turn: 'A', winner: null, reason: null, capturedTypes: { A: [], B: [] }, moveHistory: [] };
  const state10b = applyMove(state10, 7, 8, 8, 8);

  assert(state10b.winner === 'A', 'Phe A thắng khi vào ô i9 = [8][8]');

  // Phe B vào ô a1 = [0][0]
  const board10b = Array.from({ length: 9 }, () => Array(9).fill(null));
  board10b[1][0] = { type: 'S', player: 'B' }; // B gần ô đích [0][0]
  board10b[8][8] = { type: 'H', player: 'A' }; // A còn quân

  const state10c = { board: board10b, turn: 'B', winner: null, reason: null, capturedTypes: { A: [], B: [] }, moveHistory: [] };
  const state10d = applyMove(state10c, 1, 0, 0, 0);

  assert(state10d.winner === 'B', 'Phe B thắng khi vào ô a1 = [0][0]');
  console.groupEnd();

  // ── Test 11: isGoalSquare ─────────────────────────────────────────────────
  console.group('Test 11: isGoalSquare');
  assert(isGoalSquare(8, 8, 'A') === true, 'A đến [8][8] là đích');
  assert(isGoalSquare(0, 0, 'A') === false, 'A đến [0][0] KHÔNG phải đích');
  assert(isGoalSquare(0, 0, 'B') === true, 'B đến [0][0] là đích');
  assert(isGoalSquare(8, 8, 'B') === false, 'B đến [8][8] KHÔNG phải đích');
  console.groupEnd();

  // ── Test 12: Không còn nước đi → thua ─────────────────────────────────────
  console.group('Test 12: Không còn nước đi → thua');
  // Tạo tình huống A bị bao vây hoàn toàn
  const board12 = Array.from({ length: 9 }, () => Array(9).fill(null));
  // A chỉ có Bao P ở [0][0], xung quanh là Kéo B (S thắng P)
  board12[0][0] = { type: 'P', player: 'A' };
  board12[0][1] = { type: 'S', player: 'B' }; // S thắng P → P của A không thể đi vào
  board12[1][0] = { type: 'S', player: 'B' };
  board12[1][1] = { type: 'S', player: 'B' };
  // A không thể đi đâu (cả 3 ô lân cận đều bị Kéo B chặn)

  const state12 = { board: board12, turn: 'A', winner: null, reason: null, capturedTypes: { A: [], B: [] }, moveHistory: [] };
  const result12 = isGameOver(state12);
  assert(result12.over === true && result12.winner === 'B', 'B thắng khi A không còn nước đi');
  console.groupEnd();

  // ── Kết quả ────────────────────────────────────────────────────────────────
  console.groupEnd();
  console.log(`\n📊 Kết quả: ${passed} PASS / ${failed} FAIL / ${passed + failed} total`);
  if (failed === 0) {
    console.log('🎉 Tất cả test cases PASSED!');
  }

  return { passed, failed };
}

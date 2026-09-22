/**
 * net/sync.js — Tích hợp PlayHTML để đồng bộ trạng thái game real-time.
 *
 * Chuẩn API theo tài liệu chính thức:
 *   await playhtml.init({ room: 'ottv2-hub-production' });
 *   await playhtml.ready;
 *   const channel = playhtml.createPageData(channelKey, defaultState);
 *   const data = channel.getData();
 *   channel.setData((draft) => { ... });
 *   channel.onUpdate((data) => { ... });
 */

import { playhtml } from 'https://unpkg.com/playhtml';
import { createInitialBoard, getLegalMoves, applyMove } from '../core/game.js';

// ── Tên Hub toàn cục dùng chung để Spectator và các phòng cùng kết nối ────────
const GLOBAL_APP_ROOM = 'ottv2-hub-production';

// ── State module ─────────────────────────────────────────────────────────────
let _gameChannel = null;
let _roomsChannel = null;
let _roomId = null;
let _myPlayer = null;
let _onStateUpdate = null;
let _initPromise = null;

// Khởi tạo PlayHTML một lần duy nhất kết nối vào Hub chung
async function _ensureInit() {
  if (!_initPromise) {
    _initPromise = (async () => {
      console.log('[sync] Initializing PlayHTML Hub:', GLOBAL_APP_ROOM);
      await playhtml.init({ room: GLOBAL_APP_ROOM });
      await playhtml.ready;
      console.log('[sync] PlayHTML ready ✅');
    })();
  }
  await _initPromise;
}

// Helper lấy data từ channel an toàn
function _getChannelData(channel = _gameChannel) {
  if (!channel) return null;
  if (typeof channel.getData === 'function') {
    return channel.getData();
  }
  return channel.data ?? null;
}

// ── Khởi tạo sync cho phòng chơi ──────────────────────────────────────────────

/**
 * Khởi tạo kết nối PlayHTML cho một phòng chơi.
 * Tự động phân bổ vào bên (Xanh hoặc Đỏ) chưa được chọn nếu bên yêu cầu đã có người.
 *
 * @param {string} roomId - Mã phòng
 * @param {string|null} requestedPlayer - 'A' | 'B' | null
 * @param {Function} onStateUpdate - callback(state) khi state thay đổi
 * @returns {Promise<{ state: GameState, assignedPlayer: string|null }>}
 */
export async function initSync(roomId, requestedPlayer, onStateUpdate) {
  _roomId = roomId;
  _onStateUpdate = onStateUpdate;

  // 1. Khởi tạo và đợi kết nối hoàn tất
  await _ensureInit();

  const defaultState = createInitialBoard();
  const channelKey = `ottv2-game-${roomId}`;

  // 2. Tạo channel sau khi playhtml.ready
  _gameChannel = playhtml.createPageData(channelKey, defaultState);

  // 3. Lấy dữ liệu hiện tại từ channel
  const currentData = _getChannelData(_gameChannel) || defaultState;
  const joinedA = !!currentData.joinedPlayers?.A;
  const joinedB = !!currentData.joinedPlayers?.B;

  let assignedPlayer = requestedPlayer;

  // 4. Phân bổ vào bên chưa được chọn
  if (assignedPlayer === 'A') {
    if (joinedA && !joinedB) {
      // Phe A đã có người -> chuyển sang Phe B chưa được chọn
      assignedPlayer = 'B';
    } else if (joinedA && joinedB) {
      // Cả 2 phe đã có người -> Spectator
      assignedPlayer = null;
    }
  } else if (assignedPlayer === 'B') {
    if (joinedB && !joinedA) {
      // Phe B đã có người -> chuyển sang Phe A chưa được chọn
      assignedPlayer = 'A';
    } else if (joinedA && joinedB) {
      // Cả 2 phe đã có người -> Spectator
      assignedPlayer = null;
    }
  } else if (!assignedPlayer) {
    // Không chỉ định phe -> tự động chọn bên còn trống
    if (!joinedA) {
      assignedPlayer = 'A';
    } else if (!joinedB) {
      assignedPlayer = 'B';
    } else {
      assignedPlayer = null;
    }
  }

  _myPlayer = assignedPlayer;

  // 5. Subscribe cập nhật real-time
  _gameChannel.onUpdate((data) => {
    if (data && _onStateUpdate) {
      _onStateUpdate(data);
    }
  });

  // 6. Kiểm tra xem bàn cờ có cần xáo ngẫu nhiên không:
  // - Nếu là phòng mới tạo (chưa có ai vào trước)
  // - Hoặc phòng chưa đi nước nào và đang mang cấu hình cũ chưa random
  const needsRandomize = (!joinedA && !joinedB) || (
    (!currentData.moveHistory || currentData.moveHistory.length === 0) &&
    _isOldDefaultBoard(currentData.board)
  );

  const initialBoardToUse = needsRandomize ? defaultState.board : currentData.board;

  // 7. Đăng ký phòng vào registry toàn cục và cập nhật joinedPlayers & board
  if (_myPlayer) {
    _registerRoom(roomId, _myPlayer);
    try {
      _gameChannel.setData((draft) => {
        if (!draft.joinedPlayers) draft.joinedPlayers = { A: false, B: false };
        draft.joinedPlayers[_myPlayer] = true;
        if (needsRandomize) {
          draft.board = defaultState.board;
          draft.turn = defaultState.turn;
          draft.winner = null;
          draft.reason = null;
          draft.capturedTypes = { A: [], B: [] };
          draft.moveHistory = [];
        }
      });
    } catch (e) {
      console.warn('[sync] set joinedPlayers error:', e);
    }
  }

  // 8. Trả về state và assignedPlayer
  return {
    state: _getChannelData(_gameChannel) ?? defaultState,
    assignedPlayer: _myPlayer,
  };
}

/**
 * Kiểm tra xem bàn cờ có đang là cấu hình cố định cũ (HHHSSSPPP) không.
 */
function _isOldDefaultBoard(board) {
  if (!board || !board[0] || !board[1] || !board[2]) return true;
  return (
    board[0][0]?.type === 'H' &&
    board[0][1]?.type === 'H' &&
    board[0][2]?.type === 'H' &&
    board[1][0]?.type === 'S' &&
    board[1][1]?.type === 'S' &&
    board[1][2]?.type === 'S' &&
    board[2][0]?.type === 'P' &&
    board[2][1]?.type === 'P' &&
    board[2][2]?.type === 'P'
  );
}

/**
 * Đổi vị trí quân ngẫu nhiên đối xứng (chỉ khi trận đấu chưa bắt đầu).
 */
export function reshuffleStartingPositions() {
  if (!_gameChannel || !_myPlayer) return false;
  const currentData = _getChannelData(_gameChannel);
  if (!currentData) return false;

  // Không cho xáo khi đã đi nước cờ
  if (currentData.moveHistory && currentData.moveHistory.length > 0) {
    return false;
  }

  const fresh = createInitialBoard(true);
  try {
    _gameChannel.setData((draft) => {
      draft.board = fresh.board;
      draft.turn = 'A';
      draft.winner = null;
      draft.reason = null;
      draft.capturedTypes = { A: [], B: [] };
      draft.moveHistory = [];
    });
  } catch (e) {
    _gameChannel.setData({
      ...currentData,
      board: fresh.board,
    });
  }
  return true;
}

export function getMyPlayer() {
  return _myPlayer;
}

// ── Gửi nước đi ───────────────────────────────────────────────────────────────

/**
 * Validate và gửi nước đi lên PlayHTML.
 * @returns {boolean} true nếu hợp lệ và đã gửi
 */
export function sendMove(fromRow, fromCol, toRow, toCol) {
  if (!_gameChannel) {
    console.warn('[sync] _gameChannel is null');
    return false;
  }

  const currentData = _getChannelData(_gameChannel);
  if (!currentData) {
    console.warn('[sync] currentData is null');
    return false;
  }

  // Kiểm tra đủ 2 người chơi chưa
  if (!currentData.joinedPlayers?.A || !currentData.joinedPlayers?.B) {
    console.warn('[sync] Chưa đủ 2 người chơi trong phòng (cần cả phe A và phe B)');
    return false;
  }

  if (currentData.turn !== _myPlayer) {
    console.warn(`[sync] Không phải lượt của bạn (turn: ${currentData.turn}, myPlayer: ${_myPlayer})`);
    return false;
  }

  if (currentData.winner !== null) {
    console.warn('[sync] Game đã kết thúc');
    return false;
  }

  // Validate qua core logic
  const legalMoves = getLegalMoves(currentData.board, fromRow, fromCol);
  const isLegal = legalMoves.some(m => m.row === toRow && m.col === toCol);

  if (!isLegal) {
    console.warn(`[sync] Nước đi không hợp lệ: [${fromRow},${fromCol}] → [${toRow},${toCol}]`);
    return false;
  }

  // Tính state mới
  const newState = applyMove(currentData, fromRow, fromCol, toRow, toCol);

  // Ghi lên PlayHTML
  try {
    _gameChannel.setData((draft) => {
      draft.board         = newState.board;
      draft.turn          = newState.turn;
      draft.winner        = newState.winner;
      draft.reason        = newState.reason;
      draft.capturedTypes = newState.capturedTypes;
      draft.moveHistory   = newState.moveHistory;
      draft.rematchVotes  = newState.rematchVotes ?? { A: false, B: false };
    });
  } catch (err) {
    console.warn('[sync] setData with draft updater failed, fallback to direct object:', err);
    _gameChannel.setData(newState);
  }

  _updateRoomActivity(_roomId);
  return true;
}

// ── Presence ─────────────────────────────────────────────────────────────────

export async function subscribePresence(onPresenceUpdate) {
  await _ensureInit();

  if (typeof playhtml.onPresenceChange === 'function') {
    playhtml.onPresenceChange((users) => {
      const playerA = users.some(u => u.metadata?.player === 'A' && u.metadata?.roomId === _roomId);
      const playerB = users.some(u => u.metadata?.player === 'B' && u.metadata?.roomId === _roomId);
      onPresenceUpdate({ playerA, playerB, count: users.length });
    });
  }

  if (_myPlayer && typeof playhtml.setUserMetadata === 'function') {
    playhtml.setUserMetadata({ player: _myPlayer, roomId: _roomId });
  }
}

// ── Registry (cho spectator) ──────────────────────────────────────────────────

function _registerRoom(roomId, player) {
  if (!_roomsChannel) {
    _roomsChannel = playhtml.createPageData('ottv2-rooms-registry', { rooms: {} });
  }

  try {
    _roomsChannel.setData((draft) => {
      if (!draft.rooms) draft.rooms = {};
      if (!draft.rooms[roomId]) {
        draft.rooms[roomId] = {
          playerA: false,
          playerB: false,
          lastActivity: Date.now(),
          createdAt: Date.now(),
        };
      }
      if (player === 'A') draft.rooms[roomId].playerA = true;
      if (player === 'B') draft.rooms[roomId].playerB = true;
      draft.rooms[roomId].lastActivity = Date.now();
    });
  } catch (e) {
    console.warn('[sync] _registerRoom error:', e);
  }
}

function _updateRoomActivity(roomId) {
  if (!_roomsChannel) return;
  try {
    _roomsChannel.setData((draft) => {
      if (draft.rooms?.[roomId]) {
        draft.rooms[roomId].lastActivity = Date.now();
      }
    });
  } catch (e) {
    console.warn('[sync] _updateRoomActivity error:', e);
  }
}

export function unregisterRoom() {
  if (!_roomId || !_myPlayer) return;

  if (_gameChannel) {
    try {
      _gameChannel.setData((draft) => {
        if (draft.joinedPlayers) {
          draft.joinedPlayers[_myPlayer] = false;
        }
      });
    } catch (e) {}
  }

  if (_roomsChannel) {
    try {
      _roomsChannel.setData((draft) => {
        if (draft.rooms?.[_roomId]) {
          if (_myPlayer === 'A') draft.rooms[_roomId].playerA = false;
          if (_myPlayer === 'B') draft.rooms[_roomId].playerB = false;
        }
      });
    } catch (e) {
      console.warn('[sync] unregisterRoom error:', e);
    }
  }
}

// ── Subscribe cho spectator ───────────────────────────────────────────────────

export async function subscribeAllRooms(onRoomList, onRoomState) {
  await _ensureInit();

  if (!_roomsChannel) {
    _roomsChannel = playhtml.createPageData('ottv2-rooms-registry', { rooms: {} });
  }

  const subscribedRooms = new Map();

  function subscribeRoom(roomId) {
    if (subscribedRooms.has(roomId)) return;
    const ch = playhtml.createPageData(`ottv2-game-${roomId}`, createInitialBoard());
    subscribedRooms.set(roomId, ch);
    ch.onUpdate((state) => {
      if (state) onRoomState(roomId, state);
    });
    const d = _getChannelData(ch);
    if (d) onRoomState(roomId, d);
  }

  _roomsChannel.onUpdate((data) => {
    const rooms = data?.rooms || {};
    onRoomList(rooms);
    for (const roomId of Object.keys(rooms)) {
      subscribeRoom(roomId);
    }
  });

  const roomsData = _getChannelData(_roomsChannel);
  if (roomsData?.rooms) {
    onRoomList(roomsData.rooms);
    for (const roomId of Object.keys(roomsData.rooms)) {
      subscribeRoom(roomId);
    }
  }
}

// ── Chơi lại (Cần cả 2 cùng đồng ý) ─────────────────────────────────────────

export function requestRematch() {
  if (!_gameChannel || !_myPlayer) return;

  const currentData = _getChannelData(_gameChannel);
  if (!currentData) return;

  const currentVotes = { ...(currentData.rematchVotes || { A: false, B: false }) };
  currentVotes[_myPlayer] = true;

  // Nếu cả 2 đều đã đồng ý -> Reset ván mới!
  if (currentVotes.A && currentVotes.B) {
    const fresh = createInitialBoard();
    try {
      _gameChannel.setData((draft) => {
        draft.board         = fresh.board;
        draft.turn          = fresh.turn;
        draft.winner        = fresh.winner;
        draft.reason        = fresh.reason;
        draft.capturedTypes = fresh.capturedTypes;
        draft.moveHistory   = fresh.moveHistory;
        draft.rematchVotes  = { A: false, B: false };
        draft.joinedPlayers = { A: true, B: true };
      });
    } catch (e) {
      _gameChannel.setData({
        ...fresh,
        joinedPlayers: { A: true, B: true },
      });
    }
  } else {
    // Chỉ mới 1 bên đồng ý -> Lưu vote chờ bên kia
    try {
      _gameChannel.setData((draft) => {
        if (!draft.rematchVotes) draft.rematchVotes = { A: false, B: false };
        draft.rematchVotes[_myPlayer] = true;
      });
    } catch (e) {
      _gameChannel.setData({
        ...currentData,
        rematchVotes: currentVotes,
      });
    }
  }
}

export function getCurrentState() {
  return _getChannelData(_gameChannel);
}

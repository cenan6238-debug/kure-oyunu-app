const BOARD_SIZE = 7;
const CAPTURE_GOAL = 4;

const INITIAL_GOLD = Array.from({ length: BOARD_SIZE }, (_, col) => ({
  row: 0,
  col,
}));

const INITIAL_INDIGO = Array.from({ length: BOARD_SIZE }, (_, col) => ({
  row: BOARD_SIZE - 1,
  col,
}));

const ADJACENT_DIRECTIONS = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
];

const LINE_DIRECTIONS = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 },
];

function createInitialState() {
  const board = createEmptyBoard();

  INITIAL_GOLD.forEach((coord, index) => {
    board[coord.row][coord.col] = {
      id: `gold-${index}`,
      player: 'gold',
      hasMoved: false,
      homeRow: coord.row,
    };
  });

  INITIAL_INDIGO.forEach((coord, index) => {
    board[coord.row][coord.col] = {
      id: `indigo-${index}`,
      player: 'indigo',
      hasMoved: false,
      homeRow: coord.row,
    };
  });

  return {
    board,
    turn: 'gold',
    captured: {
      gold: 0,
      indigo: 0,
    },
    winner: null,
    turnCount: 1,
    lastMove: null,
  };
}

function applyMove(state, move) {
  if (!isLegalMove(state, move.from, move.to)) {
    return null;
  }

  const board = cloneBoard(state.board);
  const movingStone = board[move.from.row][move.from.col];

  if (!movingStone) {
    return null;
  }

  board[move.from.row][move.from.col] = null;
  board[move.to.row][move.to.col] = {
    ...movingStone,
    hasMoved: true,
  };

  const captures = collectCaptures(board, move.to);
  captures.forEach((coord) => {
    board[coord.row][coord.col] = null;
  });

  const nextState = {
    board,
    turn: getOpponent(state.turn),
    captured: {
      ...state.captured,
      [state.turn]: state.captured[state.turn] + captures.length,
    },
    winner: null,
    turnCount: state.turnCount + 1,
    lastMove: move,
  };

  if (nextState.captured[state.turn] >= CAPTURE_GOAL) {
    nextState.winner = state.turn;
    return { state: nextState, captures };
  }

  if (!hasAnyMoves(nextState, nextState.turn)) {
    nextState.winner = state.turn;
    return { state: nextState, captures };
  }

  return { state: nextState, captures };
}

function getAllMoves(state, player) {
  const moves = [];

  forEachStone(state.board, (coord, stone) => {
    if (stone.player !== player) {
      return;
    }

    getValidMoves({ ...state, turn: player }, coord).forEach((target) => {
      moves.push({
        from: coord,
        to: target,
      });
    });
  });

  return moves;
}

function getValidMoves(state, from) {
  const stone = state.board[from.row] && state.board[from.row][from.col];

  if (!stone || stone.player !== state.turn || state.winner) {
    return [];
  }

  const moves = [];

  for (let row = from.row - 1; row <= from.row + 1; row += 1) {
    for (let col = from.col - 1; col <= from.col + 1; col += 1) {
      const target = { row, col };
      if (!isLegalMove(state, from, target)) {
        continue;
      }
      moves.push(target);
    }
  }

  return moves;
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
}

function cloneBoard(board) {
  return board.map((row) =>
    row.map((cell) => {
      if (!cell) {
        return null;
      }
      return { ...cell };
    }),
  );
}

function isLegalMove(state, from, to) {
  if (!isInBounds(from) || !isInBounds(to)) {
    return false;
  }

  if (from.row === to.row && from.col === to.col) {
    return false;
  }

  const stone = state.board[from.row][from.col];
  if (!stone || stone.player !== state.turn) {
    return false;
  }

  if (state.board[to.row][to.col]) {
    return false;
  }

  const rowDelta = to.row - from.row;
  const colDelta = to.col - from.col;

  if (Math.abs(rowDelta) > 1 || Math.abs(colDelta) > 1) {
    return false;
  }

  if (rowDelta === 0) {
    return false;
  }

  const forward = stone.player === 'gold' ? 1 : -1;

  if (!stone.hasMoved && rowDelta !== forward) {
    return false;
  }

  if (stone.hasMoved && to.row === stone.homeRow) {
    return false;
  }

  const previewBoard = cloneBoard(state.board);
  previewBoard[from.row][from.col] = null;
  previewBoard[to.row][to.col] = {
    ...stone,
    hasMoved: true,
  };

  const captures = collectCaptures(previewBoard, to);
  captures.forEach((coord) => {
    previewBoard[coord.row][coord.col] = null;
  });

  if (createsLineOfFourFromAnchor(previewBoard, stone.player, to)) {
    return false;
  }

  return true;
}

function collectCaptures(board, center) {
  const captures = [];
  const stone = board[center.row][center.col];

  if (!stone) {
    return captures;
  }

  ADJACENT_DIRECTIONS.forEach((direction) => {
    const middle = {
      row: center.row + direction.row,
      col: center.col + direction.col,
    };
    const far = {
      row: center.row + direction.row * 2,
      col: center.col + direction.col * 2,
    };

    if (!isInBounds(middle) || !isInBounds(far)) {
      return;
    }

    const middleStone = board[middle.row][middle.col];
    const farStone = board[far.row][far.col];

    if (
      middleStone &&
      middleStone.player !== stone.player &&
      farStone &&
      farStone.player === stone.player
    ) {
      captures.push(middle);
    }
  });

  return dedupeCoords(captures);
}

function createsLineOfFourFromAnchor(board, player, anchor) {
  for (const direction of LINE_DIRECTIONS) {
    let count = 1;

    count += countDirection(board, player, anchor, direction, 1);
    count += countDirection(board, player, anchor, direction, -1);

    if (count >= 4) {
      return true;
    }
  }

  return false;
}

function countDirection(board, player, anchor, direction, stepSign) {
  let count = 0;

  for (let step = 1; step < 4; step += 1) {
    const next = {
      row: anchor.row + direction.row * step * stepSign,
      col: anchor.col + direction.col * step * stepSign,
    };

    if (!isInBounds(next) || board[next.row][next.col]?.player !== player) {
      break;
    }

    count += 1;
  }

  return count;
}

function hasAnyMoves(state, player) {
  return getAllMoves(state, player).length > 0;
}

function getOpponent(player) {
  return player === 'gold' ? 'indigo' : 'gold';
}

function isInBounds(coord) {
  return (
    coord.row >= 0 &&
    coord.row < BOARD_SIZE &&
    coord.col >= 0 &&
    coord.col < BOARD_SIZE
  );
}

function dedupeCoords(coords) {
  const seen = new Set();
  return coords.filter((coord) => {
    const key = `${coord.row}-${coord.col}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function forEachStone(board, callback) {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const stone = board[row][col];
      if (stone) {
        callback({ row, col }, stone);
      }
    }
  }
}

module.exports = {
  createInitialState,
  applyMove,
};

export const BOARD_SIZE = 7;
export const CAPTURE_GOAL = 4;

export type Player = 'gold' | 'indigo';

export type Coord = {
  row: number;
  col: number;
};

export type Stone = {
  id: string;
  player: Player;
  hasMoved: boolean;
  homeRow: number;
};

export type Cell = Stone | null;

export type Move = {
  from: Coord;
  to: Coord;
};

export type MoveResult = {
  state: GameState;
  captures: Coord[];
};

export type GameState = {
  board: Cell[][];
  turn: Player;
  captured: Record<Player, number>;
  winner: Player | null;
  turnCount: number;
  lastMove: Move | null;
};

const INITIAL_GOLD: Coord[] = Array.from({ length: BOARD_SIZE }, (_, col) => ({
  row: BOARD_SIZE - 1,
  col,
}));

const INITIAL_INDIGO: Coord[] = Array.from({ length: BOARD_SIZE }, (_, col) => ({
  row: 0,
  col,
}));

const ADJACENT_DIRECTIONS: Coord[] = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
];

const LINE_DIRECTIONS: Coord[] = [
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: -1 },
];

export function createInitialState(): GameState {
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

export function getValidMoves(state: GameState, from: Coord): Coord[] {
  const stone = state.board[from.row]?.[from.col];

  if (!stone || stone.player !== state.turn || state.winner) {
    return [];
  }

  const moves: Coord[] = [];

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

export function applyMove(state: GameState, move: Move): MoveResult | null {
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

  const nextState: GameState = {
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

export function getAllMoves(state: GameState, player: Player): Move[] {
  const moves: Move[] = [];

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

export function chooseComputerMove(state: GameState, difficulty = 10): Move | null {
  const moves = getAllMoves(state, state.turn);

  if (!moves.length) {
    return null;
  }

  const clampedDifficulty = Math.max(1, Math.min(10, Math.round(difficulty)));
  const scoredMoves: Array<{ move: Move; score: number }> = [];

  moves.forEach((move) => {
    const result = applyMove(state, move);

    if (!result) {
      return;
    }

    const immediateScore = scoreBoard(result.state, state.turn) + result.captures.length * 18;
    const replyMoves = getAllMoves(result.state, result.state.turn);
    let replyScore = 0;

    replyMoves.forEach((replyMove) => {
      const replyResult = applyMove(result.state, replyMove);

      if (!replyResult) {
        return;
      }

      const current = scoreBoard(replyResult.state, result.state.turn) + replyResult.captures.length * 10;
      if (current > replyScore) {
        replyScore = current;
      }
    });

    const totalScore = immediateScore - replyScore * 0.8;
    scoredMoves.push({ move, score: totalScore });
  });

  if (!scoredMoves.length) {
    return null;
  }

  scoredMoves.sort((a, b) => b.score - a.score);

  if (clampedDifficulty === 10) {
    return scoredMoves[0].move;
  }

  const randomBlunderChance = (10 - clampedDifficulty) / 10;
  if (Math.random() < randomBlunderChance * 0.6) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const candidatePoolSize = Math.max(
    1,
    Math.min(scoredMoves.length, 1 + (10 - clampedDifficulty) * 2),
  );

  return scoredMoves[Math.floor(Math.random() * candidatePoolSize)].move;
}

export function getStoneCount(state: GameState, player: Player): number {
  let count = 0;
  forEachStone(state.board, (_, stone) => {
    if (stone.player === player) {
      count += 1;
    }
  });
  return count;
}

function createEmptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
}

function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) =>
    row.map((cell) => {
      if (!cell) {
        return null;
      }
      return { ...cell };
    }),
  );
}

function isLegalMove(state: GameState, from: Coord, to: Coord): boolean {
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

  const forward = stone.homeRow === 0 ? 1 : -1;

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

  if (hasForbiddenLineFromAnchor(previewBoard, stone.player, to)) {
    return false;
  }

  return true;
}

function collectCaptures(board: Cell[][], center: Coord): Coord[] {
  const captures: Coord[] = [];
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

function hasForbiddenLineFromAnchor(board: Cell[][], player: Player, anchor: Coord): boolean {
  for (const direction of LINE_DIRECTIONS) {
    if (countStonesOnLine(board, player, anchor, direction) >= 4) {
      return true;
    }
  }

  return false;
}

function countStonesOnLine(
  board: Cell[][],
  player: Player,
  anchor: Coord,
  direction: Coord,
): number {
  let row = anchor.row;
  let col = anchor.col;

  while (
    isInBounds({
      row: row - direction.row,
      col: col - direction.col,
    })
  ) {
    row -= direction.row;
    col -= direction.col;
  }

  let count = 0;
  while (isInBounds({ row, col })) {
    if (board[row][col]?.player === player) {
      count += 1;
    }
    row += direction.row;
    col += direction.col;
  }

  return count;
}

function hasAnyMoves(state: GameState, player: Player): boolean {
  return getAllMoves(state, player).length > 0;
}

function getOpponent(player: Player): Player {
  return player === 'gold' ? 'indigo' : 'gold';
}

function isInBounds(coord: Coord): boolean {
  return (
    coord.row >= 0 &&
    coord.row < BOARD_SIZE &&
    coord.col >= 0 &&
    coord.col < BOARD_SIZE
  );
}

function dedupeCoords(coords: Coord[]): Coord[] {
  const seen = new Set<string>();
  return coords.filter((coord) => {
    const key = `${coord.row}-${coord.col}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreBoard(state: GameState, player: Player): number {
  const centerBonus =
    countCenterControl(state, player) * 3 - countCenterControl(state, getOpponent(player)) * 3;
  const captureBonus = (state.captured[player] - state.captured[getOpponent(player)]) * 12;
  const mobilityBonus =
    getAllMoves(state, player).length - getAllMoves(state, getOpponent(player)).length;
  const stoneBonus = getStoneCount(state, player) - getStoneCount(state, getOpponent(player));
  const winBonus = state.winner === player ? 1000 : state.winner === getOpponent(player) ? -1000 : 0;

  return centerBonus + captureBonus + mobilityBonus + stoneBonus * 4 + winBonus;
}

function countCenterControl(state: GameState, player: Player): number {
  let count = 0;

  forEachStone(state.board, (coord, stone) => {
    if (stone.player !== player) {
      return;
    }

    const rowDistance = Math.abs(coord.row - 3);
    const colDistance = Math.abs(coord.col - 3);

    if (rowDistance <= 1 && colDistance <= 1) {
      count += 1;
    } else if (rowDistance <= 2 && colDistance <= 2) {
      count += 0.5;
    }
  });

  return count;
}

function forEachStone(
  board: Cell[][],
  callback: (coord: Coord, stone: Stone) => void,
) {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const stone = board[row][col];
      if (stone) {
        callback({ row, col }, stone);
      }
    }
  }
}

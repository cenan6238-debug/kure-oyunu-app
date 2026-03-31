const cors = require('cors');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { applyMove, createInitialState } = require('./gameEngine');

const PORT = Number(process.env.PORT || 4000);
const ROOM_CODE_LENGTH = 5;
const MAX_ROOMS = 500;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, response) => {
  response.json({
    ok: true,
    rooms: rooms.size,
    openRooms: listOpenRooms().length,
    timestamp: Date.now(),
  });
});

app.get('/rooms', (_, response) => {
  response.json({
    ok: true,
    rooms: listOpenRooms(),
    timestamp: Date.now(),
  });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('create_room', ({ nickname }) => {
    if (rooms.size >= MAX_ROOMS) {
      socket.emit('room_error', { message: 'Sunucu dolu. Sonra tekrar dene.' });
      return;
    }

    const room = createRoom(socket, nickname);
    attachSocketToRoom(socket, room.roomCode, 'gold');

    socket.emit('room_created', {
      roomCode: room.roomCode,
      color: 'gold',
      state: room.state,
      players: exportPlayers(room),
      message: 'Oda olusturuldu. Rakibi bekliyorsun.',
    });
  });

  socket.on('join_room', ({ roomCode, nickname }) => {
    const code = normalizeRoomCode(roomCode);
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room_error', { message: 'Bu oda bulunamadi.' });
      return;
    }

    if (room.players.indigo) {
      socket.emit('room_error', { message: 'Bu oda dolu.' });
      return;
    }

    room.players.indigo = {
      id: socket.id,
      nickname: sanitizeNickname(nickname),
    };

    attachSocketToRoom(socket, code, 'indigo');

    socket.emit('room_joined', {
      roomCode: code,
      color: 'indigo',
      state: room.state,
      players: exportPlayers(room),
      message: 'Odaya katildin.',
    });

    io.to(code).emit('room_update', {
      state: room.state,
      players: exportPlayers(room),
      message: 'Eslesme hazir. Altin taraf oyuna baslar.',
    });
  });

  socket.on('quick_match', ({ nickname }) => {
    const openRoom = findOldestOpenRoom();

    if (openRoom) {
      openRoom.players.indigo = {
        id: socket.id,
        nickname: sanitizeNickname(nickname),
      };

      attachSocketToRoom(socket, openRoom.roomCode, 'indigo');

      socket.emit('room_joined', {
        roomCode: openRoom.roomCode,
        color: 'indigo',
        state: openRoom.state,
        players: exportPlayers(openRoom),
        message: 'Hazir odaya baglandin.',
      });

      io.to(openRoom.roomCode).emit('room_update', {
        state: openRoom.state,
        players: exportPlayers(openRoom),
        message: 'Eslesme hazir. Altin taraf oyuna baslar.',
      });
      return;
    }

    if (rooms.size >= MAX_ROOMS) {
      socket.emit('room_error', { message: 'Sunucu dolu. Sonra tekrar dene.' });
      return;
    }

    const room = createRoom(socket, nickname);
    attachSocketToRoom(socket, room.roomCode, 'gold');

    socket.emit('room_created', {
      roomCode: room.roomCode,
      color: 'gold',
      state: room.state,
      players: exportPlayers(room),
      message: 'Hazir oda yoktu, yeni oda olusturuldu. Rakip bekleniyor.',
    });
  });

  socket.on('play_move', ({ roomCode, move }) => {
    const code = normalizeRoomCode(roomCode || socket.data.roomCode);
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room_error', { message: 'Oda baglantisi bulunamadi.' });
      return;
    }

    const color = getSocketColor(room, socket.id);
    if (!color) {
      socket.emit('room_error', { message: 'Bu odada oyuncu degilsin.' });
      return;
    }

    if (room.state.winner) {
      socket.emit('room_error', { message: 'Tur bitti. Yeniden baslatin.' });
      return;
    }

    if (room.state.turn !== color) {
      socket.emit('room_error', { message: 'Sira sende degil.' });
      return;
    }

    const result = applyMove(room.state, move);
    if (!result) {
      socket.emit('room_error', { message: 'Gecersiz hamle.' });
      return;
    }

    room.state = result.state;

    const message = room.state.winner
      ? `${getColorLabel(room.state.winner)} oyuncusu turu kazandi.`
      : `${getColorLabel(room.state.turn)} sirasinda.`;

    io.to(code).emit('room_update', {
      state: room.state,
      players: exportPlayers(room),
      move,
      captures: result.captures,
      by: color,
      message,
    });
  });

  socket.on('request_rematch', ({ roomCode }) => {
    const code = normalizeRoomCode(roomCode || socket.data.roomCode);
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room_error', { message: 'Oda bulunamadi.' });
      return;
    }

    if (!room.players.gold || !room.players.indigo) {
      socket.emit('room_error', { message: 'Rematch icin iki oyuncu da odada olmali.' });
      return;
    }

    room.state = createInitialState();

    io.to(code).emit('room_update', {
      state: room.state,
      players: exportPlayers(room),
      message: 'Yeni tur basladi. Altin taraf oyunda.',
    });
  });

  socket.on('leave_room', ({ roomCode }) => {
    detachSocketFromRoom(socket, normalizeRoomCode(roomCode || socket.data.roomCode));
  });

  socket.on('disconnect', () => {
    detachSocketFromRoom(socket, normalizeRoomCode(socket.data.roomCode));
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Kure online server running on :${PORT}`);
});

function attachSocketToRoom(socket, roomCode, color) {
  socket.join(roomCode);
  socket.data.roomCode = roomCode;
  socket.data.color = color;
}

function detachSocketFromRoom(socket, roomCode) {
  if (!roomCode) {
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  const color = getSocketColor(room, socket.id);
  if (!color) {
    return;
  }

  room.players[color] = null;
  socket.leave(roomCode);
  socket.data.roomCode = null;
  socket.data.color = null;

  if (!room.players.gold && !room.players.indigo) {
    rooms.delete(roomCode);
    return;
  }

  io.to(roomCode).emit('opponent_left', {
    message: 'Rakip odadan ayrildi.',
    players: exportPlayers(room),
  });
}

function exportPlayers(room) {
  return {
    gold: room.players.gold ? room.players.gold.nickname : null,
    indigo: room.players.indigo ? room.players.indigo.nickname : null,
  };
}

function getSocketColor(room, socketId) {
  if (room.players.gold && room.players.gold.id === socketId) {
    return 'gold';
  }

  if (room.players.indigo && room.players.indigo.id === socketId) {
    return 'indigo';
  }

  return null;
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || '')
    .trim()
    .toUpperCase();
}

function sanitizeNickname(input) {
  const value = String(input || '').trim();
  if (!value) {
    return 'Oyuncu';
  }
  return value.slice(0, 20);
}

function getColorLabel(color) {
  return color === 'gold' ? 'Altin' : 'Lacivert';
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  let tries = 0;

  do {
    code = '';
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    tries += 1;
  } while (rooms.has(code) && tries < 30);

  return code;
}

function createRoom(socket, nickname) {
  const roomCode = generateRoomCode();
  const room = {
    roomCode,
    createdAt: Date.now(),
    state: createInitialState(),
    players: {
      gold: {
        id: socket.id,
        nickname: sanitizeNickname(nickname),
      },
      indigo: null,
    },
  };

  rooms.set(roomCode, room);
  return room;
}

function findOldestOpenRoom() {
  const openRooms = Array.from(rooms.values())
    .filter((room) => room.players.gold && !room.players.indigo)
    .sort((a, b) => a.createdAt - b.createdAt);

  return openRooms[0] || null;
}

function listOpenRooms() {
  return Array.from(rooms.values())
    .filter((room) => room.players.gold && !room.players.indigo)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((room) => ({
      roomCode: room.roomCode,
      host: room.players.gold.nickname,
      createdAt: room.createdAt,
    }));
}

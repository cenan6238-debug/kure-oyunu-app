import { StatusBar } from 'expo-status-bar';
import { Audio } from 'expo-av';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { io, Socket } from 'socket.io-client';

import {
  applyMove,
  BOARD_SIZE,
  CAPTURE_GOAL,
  chooseComputerMove,
  Coord,
  createInitialState,
  GameState,
  getStoneCount,
  getValidMoves,
  Move,
  Player,
} from './src/game';

type Screen = 'home' | 'online' | 'rules' | 'game';
type Mode = 'cpu' | 'online';
type OnlinePlayers = Record<Player, string | null>;
type CapturedTokens = Record<Player, string[]>;
type PaletteId = 'yellow' | 'green' | 'pink' | 'blue' | 'orange' | 'purple';

type CaptureFlash = {
  by: Player;
  move: Move;
  captures: Coord[];
} | null;

type CaptureSegment = {
  centerX: number;
  centerY: number;
  angle: number;
  length: number;
  thickness: number;
};

type OpenRoom = {
  roomCode: string;
  host: string;
  createdAt: number;
};

const DEFAULT_SERVER_URL = 'http://192.168.1.101:4000';

const PLAYER_META: Record<
  Player,
  {
    label: string;
    accent: string;
    piece: string;
    shadow: string;
    shine: string;
  }
> = {
  gold: {
    label: 'Altın',
    accent: '#f4bf5f',
    piece: '#f7cf7e',
    shadow: '#a16514',
    shine: '#ffefd0',
  },
  indigo: {
    label: 'Lacivert',
    accent: '#7c93ff',
    piece: '#9ab0ff',
    shadow: '#2f3f97',
    shine: '#e3eaff',
  },
};

const PALETTE_OPTIONS: Array<{
  id: PaletteId;
  name: string;
  piece: string;
  accent: string;
  shadow: string;
  shine: string;
}> = [
  {
    id: 'yellow',
    name: 'Sarı',
    piece: '#ffd400',
    accent: '#ff9b00',
    shadow: '#c66d00',
    shine: '#fff07d',
  },
  {
    id: 'green',
    name: 'Yeşil',
    piece: '#00e676',
    accent: '#00b85d',
    shadow: '#01743e',
    shine: '#8dffbd',
  },
  {
    id: 'pink',
    name: 'Pembe',
    piece: '#ff4db8',
    accent: '#e7008f',
    shadow: '#8d0058',
    shine: '#ffabdf',
  },
  {
    id: 'blue',
    name: 'Mavi',
    piece: '#25c5ff',
    accent: '#0099dd',
    shadow: '#015f8c',
    shine: '#9be8ff',
  },
  {
    id: 'orange',
    name: 'Turuncu',
    piece: '#ff7a00',
    accent: '#ff4e00',
    shadow: '#a02a00',
    shine: '#ffc27d',
  },
  {
    id: 'purple',
    name: 'Mor',
    piece: '#9a4dff',
    accent: '#6f10ff',
    shadow: '#3f008f',
    shine: '#d2adff',
  },
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function getPaletteById(id: PaletteId) {
  return PALETTE_OPTIONS.find((palette) => palette.id === id) || PALETTE_OPTIONS[0];
}

function buildCaptureSegments(
  flash: CaptureFlash,
  cellSize: number,
  boardInset: number,
): CaptureSegment[] {
  if (!flash || !flash.captures.length) {
    return [];
  }

  return flash.captures.map((captured) => {
    const rowDelta = captured.row - flash.move.to.row;
    const colDelta = captured.col - flash.move.to.col;
    const far = {
      row: flash.move.to.row + rowDelta * 2,
      col: flash.move.to.col + colDelta * 2,
    };

    const startX = boardInset + flash.move.to.col * cellSize + cellSize / 2;
    const startY = boardInset + flash.move.to.row * cellSize + cellSize / 2;
    const endX = boardInset + far.col * cellSize + cellSize / 2;
    const endY = boardInset + far.row * cellSize + cellSize / 2;
    const distance = Math.hypot(endX - startX, endY - startY);

    return {
      centerX: (startX + endX) / 2,
      centerY: (startY + endY) / 2,
      angle: (Math.atan2(endY - startY, endX - startX) * 180) / Math.PI,
      length: distance + cellSize * 0.86,
      thickness: cellSize * 0.84,
    };
  });
}

export default function App() {
  const { width } = useWindowDimensions();
  const socketRef = useRef<Socket | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [rulesBackTarget, setRulesBackTarget] = useState<Screen>('home');
  const [mode, setMode] = useState<Mode>('cpu');
  const [state, setState] = useState<GameState>(() => createInitialState());
  const [selected, setSelected] = useState<Coord | null>(null);
  const [validTargets, setValidTargets] = useState<Coord[]>([]);
  const [statusText, setStatusText] = useState(
    'Çevrimiçi mod eklendi. Oda kurup dünyanın her yerinden oynayabilirsin.',
  );
  const [seriesScore, setSeriesScore] = useState<Record<Player, number>>({
    gold: 0,
    indigo: 0,
  });

  const [nickname, setNickname] = useState('Oyuncu');
  const [roomCode, setRoomCode] = useState('');
  const [myColor, setMyColor] = useState<Player | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayers>({
    gold: null,
    indigo: null,
  });
  const [socketConnected, setSocketConnected] = useState(false);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [matchReady, setMatchReady] = useState(false);
  const [paletteByPlayer, setPaletteByPlayer] = useState<Record<Player, PaletteId>>({
    gold: 'yellow',
    indigo: 'blue',
  });
  const [cpuDifficulty, setCpuDifficulty] = useState(5);
  const [captureFlash, setCaptureFlash] = useState<CaptureFlash>(null);
  const [capturedTokens, setCapturedTokens] = useState<CapturedTokens>({
    gold: [],
    indigo: [],
  });
  const trayPulse = useRef<Record<Player, Animated.Value>>({
    gold: new Animated.Value(1),
    indigo: new Animated.Value(1),
  }).current;
  const captureAnim = useRef(new Animated.Value(0)).current;
  const tokenCounterRef = useRef(0);
  const prevCapturedRef = useRef<Record<Player, number>>({
    gold: 0,
    indigo: 0,
  });
  const moveSoundRef = useRef<Audio.Sound | null>(null);
  const captureSoundRef = useRef<Audio.Sound | null>(null);
  const winSoundRef = useRef<Audio.Sound | null>(null);

  const boardSize = Math.min(width - 26, 430);
  const cellSize = boardSize / BOARD_SIZE;
  const boardInset = 8;
  const playerTheme = useMemo(
    () => ({
      gold: {
        ...PLAYER_META.gold,
        ...getPaletteById(paletteByPlayer.gold),
        label: getPaletteById(paletteByPlayer.gold).name,
      },
      indigo: {
        ...PLAYER_META.indigo,
        ...getPaletteById(paletteByPlayer.indigo),
        label: getPaletteById(paletteByPlayer.indigo).name,
      },
    }),
    [paletteByPlayer],
  );
  const captureSegments = useMemo(
    () => buildCaptureSegments(captureFlash, cellSize, boardInset),
    [boardInset, captureFlash, cellSize],
  );

  const isOnlineTurn =
    mode === 'online' &&
    screen === 'game' &&
    matchReady &&
    myColor === state.turn &&
    !state.winner;

  const isComputerTurn =
    mode === 'cpu' &&
    screen === 'game' &&
    state.turn === 'indigo' &&
    !state.winner;

  useEffect(() => {
    if (!selected) {
      setValidTargets([]);
      return;
    }
    setValidTargets(getValidMoves(state, selected));
  }, [selected, state]);

  useEffect(() => {
    if (!isComputerTurn) {
      return;
    }

    const timer = setTimeout(() => {
      const move = chooseComputerMove(state, cpuDifficulty);
      if (!move) {
        return;
      }
      runMove(move, true);
    }, 500);

    return () => clearTimeout(timer);
  }, [cpuDifficulty, isComputerTurn, state]);

  useEffect(() => {
    let isActive = true;

    const loadSounds = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        const [moveSound, captureSound, winSound] = await Promise.all([
          Audio.Sound.createAsync(require('./assets/sounds/move.wav')),
          Audio.Sound.createAsync(require('./assets/sounds/capture.wav')),
          Audio.Sound.createAsync(require('./assets/sounds/win.wav')),
        ]);

        if (!isActive) {
          await Promise.all([
            moveSound.sound.unloadAsync(),
            captureSound.sound.unloadAsync(),
            winSound.sound.unloadAsync(),
          ]);
          return;
        }

        moveSoundRef.current = moveSound.sound;
        captureSoundRef.current = captureSound.sound;
        winSoundRef.current = winSound.sound;
      } catch {
        setStatusText('Sesler yüklenemedi, oyun sessiz devam ediyor.');
      }
    };

    loadSounds();

    return () => {
      isActive = false;
      disconnectSocket(false);
      moveSoundRef.current?.unloadAsync();
      captureSoundRef.current?.unloadAsync();
      winSoundRef.current?.unloadAsync();
    };
  }, []);

  function playSfx(kind: 'move' | 'capture' | 'win') {
    const target =
      kind === 'move'
        ? moveSoundRef.current
        : kind === 'capture'
          ? captureSoundRef.current
          : winSoundRef.current;

    if (!target) {
      return;
    }

    target.setVolumeAsync(kind === 'capture' ? 1 : 0.92).catch(() => {});
    target
      .setPositionAsync(0)
      .then(() => target.playAsync())
      .catch(() => {
        // Sessiz fail: oyun akışını bozmasın.
      });

    if (kind === 'capture') {
      setTimeout(() => {
        target
          .setPositionAsync(0)
          .then(() => target.playAsync())
          .catch(() => {});
      }, 80);
    }
  }

  useEffect(() => {
    if (!captureFlash) {
      return;
    }

    captureAnim.setValue(0);
    Animated.sequence([
      Animated.timing(captureAnim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(750),
      Animated.timing(captureAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setCaptureFlash(null);
      }
    });
  }, [captureAnim, captureFlash]);

  useEffect(() => {
    const players: Player[] = ['gold', 'indigo'];
    players.forEach((player) => {
      const current = state.captured[player];
      const prev = prevCapturedRef.current[player];
      if (current === prev) {
        return;
      }

      if (current < prev) {
        setCapturedTokens((previous) => ({
          ...previous,
          [player]: previous[player].slice(0, current),
        }));
        prevCapturedRef.current[player] = current;
        return;
      }

      const addedCount = current - prev;
      const newIds = Array.from({ length: addedCount }, () => {
        tokenCounterRef.current += 1;
        return `${player}-${tokenCounterRef.current}`;
      });

      setCapturedTokens((previous) => ({
        ...previous,
        [player]: [...previous[player], ...newIds],
      }));

      Animated.sequence([
        Animated.timing(trayPulse[player], {
          toValue: 1.13,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(trayPulse[player], {
          toValue: 1,
          duration: 170,
          useNativeDriver: true,
        }),
      ]).start();

      prevCapturedRef.current[player] = current;
    });
  }, [state.captured, trayPulse]);

  useEffect(() => {
    if (screen !== 'online') {
      return;
    }
    refreshOpenRooms(false);
  }, [screen]);

  function connectSocket(initialAction?: (socket: Socket) => void) {
    const url = DEFAULT_SERVER_URL;

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket = io(url, {
      transports: ['websocket', 'polling'],
      timeout: 12000,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 900,
    });

    socketRef.current = socket;
    setSocketConnected(false);
    setStatusText('Sunucu bağlantısı kuruluyor...');

    let actionFired = false;

    socket.on('connect', () => {
      setSocketConnected(true);
      if (!actionFired && initialAction) {
        actionFired = true;
        initialAction(socket);
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
      if (mode === 'online') {
        setStatusText('Bağlantı kesildi, yeniden deneniyor...');
      }
    });

    socket.on('connect_error', (error) => {
      setStatusText(`Bağlantı hatası: ${error.message}`);
    });

    socket.on('room_error', (payload: { message?: string }) => {
      setStatusText(payload.message || 'Bir oda hatası oluştu.');
    });

    socket.on('room_created', (payload: OnlinePayload) => {
      enterOnlineMatch(payload, 'Oda oluşturuldu.');
    });

    socket.on('room_joined', (payload: OnlinePayload) => {
      enterOnlineMatch(payload, 'Odaya bağlandın.');
    });

    socket.on('room_update', (payload: RoomUpdatePayload) => {
      setState(payload.state);
      setOnlinePlayers(payload.players);
      setMatchReady(Boolean(payload.players.gold && payload.players.indigo));
      setStatusText(payload.message || `${playerTheme[payload.state.turn].label} sırasında.`);
      if (payload.move) {
        if (payload.captures && payload.captures.length > 0) {
          playSfx('capture');
          if (payload.state.winner) {
            setTimeout(() => playSfx('win'), 120);
          }
        } else if (payload.state.winner) {
          playSfx('win');
        } else {
          playSfx('move');
        }
      }
      if (payload.move && payload.captures && payload.captures.length > 0 && payload.by) {
        setCaptureFlash({
          by: payload.by,
          move: payload.move,
          captures: payload.captures,
        });
      }
      setSelected(null);
      setValidTargets([]);
    });

    socket.on('opponent_left', (payload: OpponentLeftPayload) => {
      setMatchReady(false);
      if (payload.players) {
        setOnlinePlayers(payload.players);
      }
      setStatusText(payload.message || 'Rakip odadan ayrıldı.');
    });
  }

  async function refreshOpenRooms(showStatus = true) {
    const url = DEFAULT_SERVER_URL;

    setIsLoadingRooms(true);

    try {
      const response = await fetch(`${url}/rooms`);
      if (!response.ok) {
        setStatusText(`Açık oda listesi alınamadı: ${response.status}`);
        return;
      }

      const payload = (await response.json()) as { rooms?: OpenRoom[] };
      const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
      setOpenRooms(rooms);

      if (showStatus) {
        setStatusText(
          rooms.length > 0
            ? `${rooms.length} açık oda bulundu.`
            : 'Şu an bekleyen açık oda yok. Hızlı eşleş veya oda oluşturabilirsin.',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen bağlantı hatası';
      setStatusText(`Açık odalar alınamadı: ${message}`);
    } finally {
      setIsLoadingRooms(false);
    }
  }

  function joinByCode(roomCodeValue: string) {
    const name = nickname.trim();
    const code = roomCodeValue.trim().toUpperCase();

    if (!name) {
      setStatusText('Lütfen oyuncu adı gir.');
      return;
    }

    if (!code) {
      setStatusText('Lütfen oda kodu gir.');
      return;
    }

    connectSocket((socket) => {
      socket.emit('join_room', { nickname: name, roomCode: code });
    });
  }

  function quickMatch() {
    const name = nickname.trim();
    if (!name) {
      setStatusText('Lütfen oyuncu adı gir.');
      return;
    }

    connectSocket((socket) => {
      socket.emit('quick_match', { nickname: name });
    });
  }

  function disconnectSocket(resetOnlineState = true) {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setSocketConnected(false);

    if (resetOnlineState) {
      setRoomCode('');
      setMyColor(null);
      setMatchReady(false);
      setOnlinePlayers({
        gold: null,
        indigo: null,
      });
    }
  }

  function enterOnlineMatch(payload: OnlinePayload, fallbackMessage: string) {
    setMode('online');
    setScreen('game');
    setRoomCode(payload.roomCode);
    setMyColor(payload.color);
    setState(payload.state);
    setOnlinePlayers(payload.players);
    setMatchReady(Boolean(payload.players.gold && payload.players.indigo));
    setSeriesScore({
      gold: 0,
      indigo: 0,
    });
    setCaptureFlash(null);
    setCapturedTokens({
      gold: [],
      indigo: [],
    });
    setSelected(null);
    setValidTargets([]);
    setStatusText(payload.message || fallbackMessage);
  }

  function startCpuMode() {
    const playerPalette = paletteByPlayer.gold;
    const palettePool = PALETTE_OPTIONS.map((palette) => palette.id).filter(
      (paletteId) => paletteId !== playerPalette,
    );
    const aiPalette = pickRandom(palettePool.length ? palettePool : [playerPalette]);

    disconnectSocket();
    setMode('cpu');
    setScreen('game');
    setState(createInitialState());
    setPaletteByPlayer({
      gold: playerPalette,
      indigo: aiPalette,
    });
    setSeriesScore({
      gold: 0,
      indigo: 0,
    });
    setCaptureFlash(null);
    setCapturedTokens({
      gold: [],
      indigo: [],
    });
    setSelected(null);
    setValidTargets([]);
    setStatusText(`Yapay zekâya karşı yeni maç başladı. Zorluk: ${cpuDifficulty}/10.`);
  }

  function createRoom() {
    const name = nickname.trim();
    if (!name) {
      setStatusText('Lütfen oyuncu adı gir.');
      return;
    }

    connectSocket((socket) => {
      socket.emit('create_room', { nickname: name });
    });
  }

  function leaveOnlineMatch() {
    if (mode === 'online' && socketRef.current && roomCode) {
      socketRef.current.emit('leave_room', { roomCode });
    }
    disconnectSocket();
    setMode('cpu');
    setScreen('home');
    setState(createInitialState());
    setCaptureFlash(null);
    setSelected(null);
    setValidTargets([]);
    setStatusText('Ana menüye döndün.');
  }

  function runMove(move: Move, forceLocal = false) {
    if (mode === 'online' && !forceLocal) {
      if (!isOnlineTurn) {
        setStatusText('Sıra sende değil.');
        return;
      }

      const localCheck = applyMove(state, move);
      if (!localCheck) {
        setStatusText('Geçersiz hamle.');
        return;
      }

      setSelected(null);
      setValidTargets([]);
      setStatusText('Hamle gönderildi, rakip ve sunucu bekleniyor...');
      socketRef.current?.emit('play_move', {
        roomCode,
        move,
      });
      return;
    }

    const result = applyMove(state, move);
    if (!result) {
      setStatusText('Bu hamle kurallara uymuyor.');
      return;
    }

    const movingPlayer = state.turn;
    const nextPlayer = result.state.turn;
    setState(result.state);
    setSelected(null);
    setValidTargets([]);

    if (result.state.winner) {
      if (result.captures.length > 0) {
        playSfx('capture');
        setTimeout(() => playSfx('win'), 120);
      } else {
        playSfx('win');
      }
      const updatedSeries = {
        ...seriesScore,
        [movingPlayer]: seriesScore[movingPlayer] + 1,
      };
      setSeriesScore(updatedSeries);
      setStatusText(
        `${playerTheme[movingPlayer].label} kazandı. Skor: ${updatedSeries.gold}-${updatedSeries.indigo}`,
      );
      return;
    }

    if (result.captures.length > 0) {
      playSfx('capture');
      setCaptureFlash({
        by: movingPlayer,
        move,
        captures: result.captures,
      });
      setStatusText(
        `${playerTheme[movingPlayer].label} ${result.captures.length} taş aldı. Sıra ${playerTheme[nextPlayer].label}.`,
      );
      return;
    }

    playSfx('move');
    setStatusText(`Sıra ${playerTheme[nextPlayer].label}.`);
  }

  function onCellPress(row: number, col: number) {
    if (state.winner) {
      return;
    }

    if (mode === 'cpu' && isComputerTurn) {
      return;
    }

    if (mode === 'online' && !isOnlineTurn) {
      return;
    }

    const target = { row, col };
    const isTarget = validTargets.some(
      (move) => move.row === target.row && move.col === target.col,
    );

    if (selected && isTarget) {
      runMove({
        from: selected,
        to: target,
      });
      return;
    }

    const stone = state.board[row][col];
    if (!stone || stone.player !== state.turn) {
      setSelected(null);
      setValidTargets([]);
      return;
    }

    const legalMoves = getValidMoves(state, target);
    setSelected(target);
    if (legalMoves.length === 0) {
      setStatusText('Bu taş için geçerli hamle yok.');
    }
  }

  function restartCurrentMode() {
    if (mode === 'online') {
      socketRef.current?.emit('request_rematch', { roomCode });
      setStatusText('Yeni tur isteği gönderildi.');
      return;
    }

    setState(createInitialState());
    setCaptureFlash(null);
    setCapturedTokens({
      gold: [],
      indigo: [],
    });
    setSelected(null);
    setValidTargets([]);
    setStatusText('Yeni tur başladı.');
  }

  function openRules(from: Screen) {
    setRulesBackTarget(from);
    setScreen('rules');
  }

  if (screen === 'rules') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.rulesScroll}>
          <View style={styles.rulesHeader}>
            <Text style={styles.rulesHeading}>Küre Oyunu - Nasıl Oynanır</Text>
            <Text style={styles.rulesSubheading}>
              Çevrimiçi modda açık odalara bağlanırsın. Oyun kuralları aynı kalır.
            </Text>
          </View>

          <RuleCard
            title="1. Başlangıç"
            text="7x7 tahtada iki oyuncu 7'şer taş ile başlar. Sen alt sıradan başlarsın ve ilk hamleyi yaparsın."
          />
          <RuleCard
            title="2. Hareket"
            text="Taşlar yatay gitmez. İlk hamle ileri/çapraz ileri; devamında ileri-geri/çapraz."
          />
          <RuleCard
            title="3. Taş Alma"
            text="Rakip taşı iki taş arasına alırsan o taşı alırsın. Yatay, dikey ve çapraz geçerli."
          />
          <RuleCard
            title="4. Kazanma"
            text={`Rakibin ${CAPTURE_GOAL} taşını önce alan oyuncu turu kazanır.`}
          />
          <RuleCard
            title="5. Dizi Kuralı"
            text="Başlangıç dizilişi hariç, aynı yatay/dikey/çapraz doğru üzerinde (arada boşluk olsa bile) en fazla 3 taş olabilir."
          />
          <RuleCard
            title="6. Çevrimiçi Oda"
            text="Bir oyuncu oda kurar, diğeri açık odalardan katılır. Hamleler anlık olarak senkronlanır."
          />

          <Pressable onPress={() => setScreen(rulesBackTarget)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Geri Dön</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'online') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.onlineScroll}>
          <View style={styles.heroCard}>
            <Text style={styles.heroTag}>ONLINE MULTIPLAYER</Text>
            <Text style={styles.heroTitle}>Oda Kur / Katıl</Text>
            <Text style={styles.heroSubtitle}>
              Aynı telefonda değil, gerçek zamanlı çevrimiçi 1v1.
            </Text>
          </View>

          <View style={styles.inputCard}>
            <Text style={styles.inputLabel}>Oyuncu Adı</Text>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              style={styles.input}
              maxLength={20}
              placeholder="Oyuncu"
              placeholderTextColor="#6f82b1"
            />
          </View>

          <View style={styles.onlineButtons}>
            <Pressable onPress={createRoom} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Oda Oluştur</Text>
            </Pressable>
          </View>

          <Pressable onPress={quickMatch} style={styles.quickMatchButton}>
            <Text style={styles.quickMatchButtonText}>Hızlı Eşleş</Text>
          </Pressable>

          <View style={styles.roomListCard}>
            <View style={styles.roomListHeader}>
              <Text style={styles.roomListTitle}>Açık Odalar</Text>
              <Pressable
                onPress={() => refreshOpenRooms(true)}
                style={styles.roomListRefreshButton}
                disabled={isLoadingRooms}
              >
                <Text style={styles.roomListRefreshButtonText}>
                  {isLoadingRooms ? 'Yenileniyor...' : 'Yenile'}
                </Text>
              </Pressable>
            </View>

            {openRooms.length === 0 ? (
              <Text style={styles.roomListEmptyText}>
                Bekleyen oda yok. İstersen hızlı eşleş ile otomatik oda bul.
              </Text>
            ) : (
              openRooms.map((room) => (
                <View key={room.roomCode} style={styles.roomRow}>
                  <View style={styles.roomMeta}>
                    <Text style={styles.roomHostText}>Kurucu: {room.host}</Text>
                  </View>
                  <Pressable
                    onPress={() => joinByCode(room.roomCode)}
                    style={styles.roomJoinButton}
                  >
                    <Text style={styles.roomJoinButtonText}>Katıl</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>

          <Pressable onPress={() => setScreen('home')} style={styles.backButton}>
            <Text style={styles.backButtonText}>Ana Menüye Dön</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.homeScroll}>
          <View style={styles.heroCard}>
            <View style={styles.heroGlowLarge} />
            <View style={styles.heroGlowSmall} />
            <Text style={styles.heroTag}>2026 EDITION</Text>
            <Text style={styles.heroTitle}>Küre Arena</Text>
            <Text style={styles.heroSubtitle}>
              Çevrimiçi eşleşme sistemi, modern arayüz ve geliştirilmiş akıcılık.
            </Text>
          </View>

          <ModeCard
            title="Çevrimiçi Oyna"
            subtitle="Aynı telefonda değil, internetten canlı oda maçı"
            accent={playerTheme.indigo.accent}
            onPress={() => {
              setScreen('online');
              setStatusText('Çevrimiçi odaya girmek için oda oluştur, katıl veya hızlı eşleş.');
            }}
          />
          <View style={[styles.modeCard, { borderColor: playerTheme.gold.accent }]}>
            <Text style={styles.modeCardTitle}>Yapay Zekâya Karşı</Text>
            <Text style={styles.modeCardSubtitle}>
              Zorluk seç, taşını özelleştir ve oyuna başla.
            </Text>
          </View>

          <View style={styles.colorPickerCard}>
            <Text style={styles.colorPickerTitle}>Yapay Zekâ Ayarları</Text>
            <Text style={styles.colorPickerHint}>Önce zorluk seç, sonra kendi taşını özelleştir.</Text>
            <DifficultyPickerRow selected={cpuDifficulty} onSelect={setCpuDifficulty} />
            <ColorPickerRow
              label={`Oyuncu Taş Rengi: ${getPaletteById(paletteByPlayer.gold).name}`}
              selected={paletteByPlayer.gold}
              onSelect={(id) =>
                setPaletteByPlayer((previous) => ({
                  ...previous,
                  gold: id,
                }))
              }
            />
            <Pressable onPress={startCpuMode} style={styles.startCpuButton}>
              <Text style={styles.startCpuButtonText}>Yapay Zekâya Karşı Başla</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => openRules('home')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Oyun Nasıl Oynanır</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.gameLayout}>
        <View style={styles.gameTopBar}>
          <Pressable onPress={mode === 'online' ? leaveOnlineMatch : () => setScreen('home')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>{mode === 'online' ? 'Odadan Çık' : 'Ana Menü'}</Text>
          </Pressable>
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{mode === 'online' ? 'ÇEVRİMİÇİ' : 'YZ'}</Text>
          </View>
          <Pressable onPress={() => openRules('game')} style={styles.iconButton}>
            <Text style={styles.iconButtonText}>Kurallar</Text>
          </Pressable>
        </View>

        {mode === 'online' ? (
          <View style={styles.onlineMetaCard}>
            <Text style={styles.onlineMetaLine}>
              Sen: {myColor ? playerTheme[myColor].label : '-'} ({nickname})
            </Text>
            <Text style={styles.onlineMetaLine}>
              {playerTheme.gold.label}: {onlinePlayers.gold || '-'} | {playerTheme.indigo.label}:{' '}
              {onlinePlayers.indigo || '-'}
            </Text>
          </View>
        ) : null}

        <View style={styles.scoreRow}>
          <ScoreCard
            player="gold"
            state={state}
            seriesScore={seriesScore}
            meta={playerTheme}
            capturedTokenIds={capturedTokens.gold}
            capturedStoneColor={playerTheme.indigo.piece}
            capturedStoneAccent={playerTheme.indigo.accent}
            trayPulse={trayPulse.gold}
          />
          <View style={styles.turnCard}>
            <Text style={styles.turnTitle}>Sıra</Text>
            <Text style={styles.turnPlayer}>
              {state.winner ? playerTheme[state.winner].label : playerTheme[state.turn].label}
            </Text>
          </View>
          <ScoreCard
            player="indigo"
            state={state}
            seriesScore={seriesScore}
            meta={playerTheme}
            capturedTokenIds={capturedTokens.indigo}
            capturedStoneColor={playerTheme.gold.piece}
            capturedStoneAccent={playerTheme.gold.accent}
            trayPulse={trayPulse.indigo}
          />
        </View>

        <View style={styles.boardShell}>
          <View style={styles.boardShadow} />
          <View style={[styles.boardFrame, { width: boardSize }]}>
            {state.board.map((boardRow, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.boardRow}>
                {boardRow.map((cell, colIndex) => {
                  const isSelected =
                    selected?.row === rowIndex && selected?.col === colIndex;
                  const isTarget = validTargets.some(
                    (move) => move.row === rowIndex && move.col === colIndex,
                  );
                  const isLastMove =
                    state.lastMove?.to.row === rowIndex &&
                    state.lastMove?.to.col === colIndex;
                  const tileColor = (rowIndex + colIndex) % 2 === 0 ? '#141418' : '#202028';

                  return (
                    <Pressable
                      key={`${rowIndex}-${colIndex}`}
                      onPress={() => onCellPress(rowIndex, colIndex)}
                      style={[
                        styles.cell,
                        {
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: tileColor,
                        },
                        isSelected && styles.selectedCell,
                        isLastMove && styles.lastMoveCell,
                      ]}
                    >
                      <View style={styles.cellRailHorizontal} />
                      <View style={styles.cellRailVertical} />
                      <View style={styles.cellInset} />
                      {isTarget ? <View style={styles.validTarget} /> : null}
                      {cell ? (
                        <View style={[styles.pieceWrap, { shadowColor: playerTheme[cell.player].shadow }]}>
                          <View
                            style={[
                              styles.piece,
                              {
                                backgroundColor: playerTheme[cell.player].piece,
                                borderColor: playerTheme[cell.player].accent,
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.pieceShine,
                                { backgroundColor: playerTheme[cell.player].shine },
                              ]}
                            />
                            <View
                              style={[
                                styles.pieceCore,
                                { backgroundColor: playerTheme[cell.player].shadow },
                              ]}
                            />
                          </View>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <View pointerEvents="none" style={styles.captureOverlayLayer}>
              {captureSegments.map((segment, index) => (
                <Animated.View
                  key={`capture-segment-${index}`}
                  style={[
                    styles.captureSegmentFrame,
                    {
                      width: segment.length,
                      height: segment.thickness,
                      left: segment.centerX - segment.length / 2,
                      top: segment.centerY - segment.thickness / 2,
                      opacity: captureAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.2, 1],
                      }),
                      transform: [{ rotate: `${segment.angle}deg` }],
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>Durum</Text>
          <Text style={styles.footerText}>{statusText}</Text>
          <View style={styles.footerActions}>
            <Pressable onPress={restartCurrentMode} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>
                {mode === 'online' ? 'Rematch İsteği' : 'Yeni Tur'}
              </Text>
            </Pressable>
            {mode === 'cpu' ? (
              <Pressable onPress={startCpuMode} style={styles.secondaryButtonInGame}>
                <Text style={styles.secondaryButtonInGameText}>Skoru Sıfırla</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function RuleCard({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.ruleCard}>
      <Text style={styles.ruleTitle}>{title}</Text>
      <Text style={styles.ruleText}>{text}</Text>
    </View>
  );
}

function ModeCard({
  title,
  subtitle,
  accent,
  onPress,
}: {
  title: string;
  subtitle: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.modeCard, { borderColor: accent }]}>
      <Text style={styles.modeCardTitle}>{title}</Text>
      <Text style={styles.modeCardSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

function DifficultyPickerRow({
  selected,
  onSelect,
}: {
  selected: number;
  onSelect: (level: number) => void;
}) {
  return (
    <View style={styles.colorPickerRow}>
      <Text style={styles.colorPickerRowLabel}>Zorluk Seviyesi: {selected}/10</Text>
      <View style={styles.levelOptions}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((level) => {
          const active = selected === level;
          return (
            <Pressable
              key={level}
              onPress={() => onSelect(level)}
              style={[styles.levelOption, active && styles.levelOptionActive]}
            >
              <Text style={[styles.levelOptionText, active && styles.levelOptionTextActive]}>{level}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ColorPickerRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: PaletteId;
  onSelect: (paletteId: PaletteId) => void;
}) {
  return (
    <View style={styles.colorPickerRow}>
      <Text style={styles.colorPickerRowLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorOptions}>
        {PALETTE_OPTIONS.map((palette) => {
          const isActive = selected === palette.id;
          return (
            <Pressable
              key={palette.id}
              onPress={() => onSelect(palette.id)}
              style={[
                styles.colorOption,
                {
                  borderColor: isActive ? palette.accent : '#d0d9ff',
                  backgroundColor: palette.piece,
                },
                isActive && styles.colorOptionActive,
              ]}
            >
              {isActive ? <Text style={styles.colorOptionCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ScoreCard({
  player,
  state,
  seriesScore,
  meta,
  capturedTokenIds,
  capturedStoneColor,
  capturedStoneAccent,
  trayPulse,
}: {
  player: Player;
  state: GameState;
  seriesScore: Record<Player, number>;
  meta: Record<
    Player,
    {
      label: string;
      accent: string;
      piece: string;
      shadow: string;
      shine: string;
      id: PaletteId;
      name: string;
    }
  >;
  capturedTokenIds: string[];
  capturedStoneColor: string;
  capturedStoneAccent: string;
  trayPulse: Animated.Value;
}) {
  return (
    <View style={[styles.scoreCard, { borderColor: meta[player].accent }]}>
      <Text style={styles.scorePlayer}>{meta[player].label}</Text>
      <Text style={styles.scoreValue}>
        {state.captured[player]} / {CAPTURE_GOAL}
      </Text>
      <Text style={styles.scoreHint}>{getStoneCount(state, player)} taş masada</Text>
      <Text style={styles.seriesScore}>Maç Skoru: {seriesScore[player]}</Text>
      <Animated.View
        style={[
          styles.capturedTray,
          {
            transform: [{ scale: trayPulse }],
          },
        ]}
      >
        {capturedTokenIds.map((tokenId) => (
          <View
            key={tokenId}
            style={[
              styles.capturedStone,
              {
                backgroundColor: capturedStoneColor,
                borderColor: capturedStoneAccent,
              },
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

type OnlinePayload = {
  roomCode: string;
  color: Player;
  state: GameState;
  players: OnlinePlayers;
  message?: string;
};

type RoomUpdatePayload = {
  state: GameState;
  players: OnlinePlayers;
  message?: string;
  move?: Move;
  captures?: Coord[];
  by?: Player;
};

type OpponentLeftPayload = {
  message?: string;
  players?: OnlinePlayers;
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#dff6ff',
  },
  homeScroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 14,
  },
  onlineScroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  rulesScroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  heroCard: {
    marginTop: 8,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: '#8bc7ff',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  heroGlowLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    right: -40,
    top: -60,
    backgroundColor: '#64c7ff',
    opacity: 0.42,
  },
  heroGlowSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 999,
    left: -28,
    bottom: -24,
    backgroundColor: '#ff9fd4',
    opacity: 0.42,
  },
  heroTag: {
    color: '#3576ff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  heroTitle: {
    marginTop: 8,
    color: '#1b3b9a',
    fontSize: 35,
    fontWeight: '900',
  },
  heroSubtitle: {
    marginTop: 10,
    color: '#4f66a8',
    fontSize: 14,
    lineHeight: 20,
  },
  modeCard: {
    borderRadius: 22,
    borderWidth: 1.5,
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  modeCardTitle: {
    color: '#1e2e66',
    fontWeight: '800',
    fontSize: 20,
  },
  modeCardSubtitle: {
    color: '#5f74b5',
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  inputCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#9acaff',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  inputLabel: {
    color: '#4b5ea1',
    fontWeight: '700',
    fontSize: 12,
    marginTop: 2,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#9ec2ff',
    backgroundColor: '#f5f9ff',
    color: '#24335f',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  onlineButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  quickMatchButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffab39',
    backgroundColor: '#ffd15c',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickMatchButtonText: {
    color: '#6a3d00',
    fontWeight: '900',
    fontSize: 13,
  },
  roomListCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#9ec5ff',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  roomListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomListTitle: {
    color: '#345ca8',
    fontWeight: '900',
    fontSize: 13,
  },
  roomListRefreshButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8ab9ff',
    backgroundColor: '#edf5ff',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  roomListRefreshButtonText: {
    color: '#2a529c',
    fontSize: 11,
    fontWeight: '800',
  },
  roomListEmptyText: {
    color: '#5a74ad',
    fontSize: 12,
    lineHeight: 18,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9e8ff',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  roomMeta: {
    flex: 1,
    gap: 2,
  },
  roomHostText: {
    color: '#6278ad',
    fontSize: 11,
  },
  roomJoinButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#51b4e5',
    backgroundColor: '#6ed9ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  roomJoinButtonText: {
    color: '#103d64',
    fontWeight: '900',
    fontSize: 12,
  },
  statusCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#9ec5ff',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  statusTitle: {
    color: '#4f6eb5',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  statusText: {
    color: '#24356c',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
  },
  statusHint: {
    color: '#4f6ea8',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  backButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#99c4ff',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#3654a3',
    fontSize: 13,
    fontWeight: '700',
  },
  rulesHeader: {
    marginTop: 8,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#9bc7ff',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  rulesHeading: {
    color: '#24408f',
    fontWeight: '900',
    fontSize: 24,
  },
  rulesSubheading: {
    color: '#5870ac',
    fontSize: 13,
    marginTop: 8,
    lineHeight: 19,
  },
  ruleCard: {
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#a4ccff',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  ruleTitle: {
    color: '#264187',
    fontWeight: '800',
    fontSize: 15,
  },
  ruleText: {
    color: '#5a72ad',
    fontSize: 13,
    marginTop: 8,
    lineHeight: 19,
  },
  gameLayout: {
    flex: 1,
    paddingHorizontal: 14,
    paddingBottom: 16,
    gap: 12,
  },
  gameTopBar: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#9ac6ff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconButtonText: {
    color: '#3556a8',
    fontWeight: '700',
    fontSize: 12,
  },
  modeBadge: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#9bc9ff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  modeBadgeText: {
    color: '#3f61b2',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  onlineMetaCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#9ec9ff',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  onlineMetaLine: {
    color: '#3d5797',
    fontSize: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
    minHeight: 132,
  },
  scoreCard: {
    flex: 1,
    height: 132,
    borderRadius: 18,
    borderWidth: 1.2,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  scorePlayer: {
    color: '#29428b',
    fontSize: 12,
    fontWeight: '700',
  },
  scoreValue: {
    color: '#1f3470',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 6,
  },
  scoreHint: {
    color: '#5d72aa',
    fontSize: 11,
    marginTop: 3,
  },
  seriesScore: {
    color: '#4d66a5',
    fontSize: 11,
    marginTop: 6,
  },
  turnCard: {
    flex: 1.2,
    height: 132,
    borderRadius: 20,
    backgroundColor: '#fff7c8',
    borderWidth: 1.2,
    borderColor: '#f3ca59',
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  turnTitle: {
    color: '#7f5b09',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  turnPlayer: {
    marginTop: 6,
    color: '#513500',
    fontSize: 21,
    fontWeight: '900',
  },
  turnText: {
    color: '#805d00',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
    minHeight: 34,
  },
  boardShell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  boardShadow: {
    position: 'absolute',
    width: '86%',
    height: 28,
    borderRadius: 999,
    backgroundColor: '#000000',
    opacity: 0.5,
    bottom: 0,
  },
  boardFrame: {
    borderRadius: 24,
    padding: 8,
    borderWidth: 1.3,
    borderColor: '#383842',
    backgroundColor: '#0c0c10',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowOffset: {
      width: 0,
      height: 16,
    },
    shadowRadius: 18,
    elevation: 14,
  },
  boardRow: {
    flexDirection: 'row',
  },
  cell: {
    borderWidth: 0.4,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellRailHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 9,
    top: '50%',
    marginTop: -4.5,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cellRailVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 9,
    left: '50%',
    marginLeft: -4.5,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  cellInset: {
    position: 'absolute',
    top: '20%',
    left: '20%',
    width: '60%',
    height: '60%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  selectedCell: {
    backgroundColor: '#30303a',
  },
  lastMoveCell: {
    borderWidth: 1.8,
    borderColor: '#ffdf5c',
  },
  captureOverlayLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  captureSegmentFrame: {
    position: 'absolute',
    borderColor: '#ffe066',
    borderWidth: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 224, 102, 0.08)',
  },
  validTarget: {
    width: 13,
    height: 13,
    borderRadius: 999,
    backgroundColor: '#ffe066',
    opacity: 0.92,
  },
  pieceWrap: {
    width: '80%',
    height: '80%',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.52,
    shadowRadius: 9,
    shadowOffset: {
      width: 0,
      height: 6,
    },
    elevation: 8,
  },
  piece: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  pieceShine: {
    position: 'absolute',
    top: '17%',
    left: '18%',
    width: '48%',
    height: '27%',
    borderRadius: 999,
    opacity: 0.36,
  },
  pieceCore: {
    width: '76%',
    height: '34%',
    borderRadius: 999,
    marginBottom: '11%',
    opacity: 0.28,
  },
  footerCard: {
    minHeight: 146,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#9bc7ff',
    backgroundColor: '#ffffff',
    padding: 16,
  },
  footerTitle: {
    color: '#5470b7',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  footerText: {
    color: '#2f4988',
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 44,
  },
  footerActions: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 9,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#ff7ec9',
    borderWidth: 1,
    borderColor: '#ef4da7',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#6ed9ff',
    borderWidth: 1,
    borderColor: '#3eb7e3',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#11456b',
    fontWeight: '800',
    fontSize: 13,
  },
  secondaryButtonInGame: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#6ed9ff',
    borderWidth: 1,
    borderColor: '#3eb7e3',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonInGameText: {
    color: '#11456b',
    fontWeight: '800',
    fontSize: 13,
  },
  colorPickerCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#98c4ff',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  colorPickerTitle: {
    color: '#23408e',
    fontSize: 17,
    fontWeight: '800',
  },
  colorPickerHint: {
    color: '#5a74b0',
    fontSize: 12,
    marginBottom: 6,
  },
  colorPickerRow: {
    gap: 7,
    marginBottom: 2,
  },
  colorPickerRowLabel: {
    color: '#405b9f',
    fontSize: 12,
    fontWeight: '700',
  },
  colorOptions: {
    gap: 8,
    paddingRight: 8,
  },
  levelOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  levelOption: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#8cbaff',
    backgroundColor: '#f3f9ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelOptionActive: {
    borderColor: '#a10061',
    backgroundColor: '#ff4db8',
    transform: [{ scale: 1.12 }],
    shadowColor: '#ff4db8',
    shadowOpacity: 0.48,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowRadius: 6,
    elevation: 6,
  },
  levelOptionText: {
    color: '#35579a',
    fontWeight: '800',
    fontSize: 12,
  },
  levelOptionTextActive: {
    color: '#ffffff',
  },
  colorOption: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorOptionActive: {
    borderWidth: 3,
  },
  colorOptionCheck: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  startCpuButton: {
    borderRadius: 14,
    backgroundColor: '#ff7ec9',
    borderWidth: 1,
    borderColor: '#ef4da7',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  startCpuButtonText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 13,
  },
  capturedTray: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 4,
    marginTop: 8,
    height: 18,
    alignItems: 'center',
  },
  capturedStone: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1.5,
  },
});

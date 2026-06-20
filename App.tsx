import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import { aiEnabled, interpret, type Turn } from './voyaAI';
import MapPane from './MapPane';

// VOYA — voice-first navigation for drivers.
// speak/type -> VOYA AI (Claude) -> geocode (Nominatim) -> routes + turn-by-turn
// (OSRM) -> in-app map + spoken turn-by-turn navigation. Real mic input ("voice
// command") needs a development build; everything else runs in Expo Go.

const C = {
  bg: '#14171C',
  surface: '#1E222B',
  surfaceAlt: '#242A35',
  border: '#2A2F3A',
  accent: '#5145E5',
  accentSoft: '#2A2750',
  text: '#F4F5F7',
  muted: '#9098A6',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#DC2626',
};

const ORIGIN = { label: 'Melbourne CBD', lat: -37.8136, lon: 144.9631 };

type Phase = 'idle' | 'listening' | 'searching' | 'results' | 'error';
type LatLng = { latitude: number; longitude: number };
type Place = { label: string; lat: number; lon: number };
type Maneuver = { instruction: string; modifier: string; type: string; lat: number; lon: number };
type Route = {
  id: string;
  name: string;
  eta: number;
  km: number;
  best?: boolean;
  coords: LatLng[];
  maneuvers: Maneuver[];
};

function shortLabel(label: string) {
  return label.split(',').slice(0, 2).join(',').trim();
}

function haversine(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat);
  const dLon = toR(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function formatDistShort(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(0, Math.round(m / 10) * 10)} m`;
}

function formatDistSpoken(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} kilometres`;
  return `${Math.max(50, Math.round(m / 50) * 50)} metres`;
}

function formatManeuver(m: any, name: string): string {
  const type = m?.type ?? '';
  const mod = m?.modifier ?? '';
  const onto = name ? ` onto ${name}` : '';
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  switch (type) {
    case 'depart':
      return name ? `Head out on ${name}` : 'Start driving';
    case 'turn':
    case 'end of road':
      return clean(`Turn ${mod}${onto}`);
    case 'new name':
      return name ? `Continue onto ${name}` : 'Continue straight';
    case 'continue':
      return clean(`Continue${mod && mod !== 'straight' ? ' ' + mod : ''}${onto}`);
    case 'merge':
      return clean(`Merge${mod ? ' ' + mod : ''}${onto}`);
    case 'on ramp':
      return `Take the on-ramp${onto}`;
    case 'off ramp':
      return `Take the exit${onto}`;
    case 'fork':
      return clean(`Keep ${mod || 'straight'}${onto}`);
    case 'roundabout':
    case 'rotary':
      return `Take the roundabout${onto}`;
    case 'arrive':
      return 'Arrive at your destination';
    default:
      return name ? `Continue onto ${name}` : 'Continue';
  }
}

function turnIcon(mod: string, type: string): any {
  if (type === 'arrive') return 'flag';
  if (mod.includes('left')) return 'arrow-undo';
  if (mod.includes('right')) return 'arrow-redo';
  if (mod.includes('uturn')) return 'refresh';
  return 'arrow-up';
}

function extractManeuvers(r: any): Maneuver[] {
  const out: Maneuver[] = [];
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const loc = s.maneuver?.location;
      if (!loc) continue;
      out.push({
        instruction: formatManeuver(s.maneuver, s.name),
        modifier: s.maneuver?.modifier ?? '',
        type: s.maneuver?.type ?? '',
        lat: loc[1],
        lon: loc[0],
      });
    }
  }
  return out;
}

// Pick the most natural English voice installed on the device. iOS/Android ship
// a basic "compact" voice plus optional higher-quality "Enhanced/Premium" ones;
// we prefer those (Australian first) so VOYA sounds far less robotic.
let chosenVoice: string | undefined;

async function initVoice() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (!voices?.length) return;
    const enhanced = (v: any) =>
      v.quality === Speech.VoiceQuality.Enhanced ||
      /enhanced|premium|neural/i.test(`${v.identifier} ${v.name}`);
    const score = (v: any) => {
      const lang = (v.language || '').toLowerCase();
      let s = lang.startsWith('en-au')
        ? 4
        : lang.startsWith('en-gb')
          ? 2
          : lang.startsWith('en')
            ? 1
            : 0;
      if (enhanced(v)) s += 5;
      if (/eloquence|compact/i.test(`${v.identifier}`)) s -= 3;
      return s;
    };
    const best = [...voices].sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) > 0) chosenVoice = best.identifier;
  } catch {}
}

function speak(text: string) {
  try {
    Speech.stop();
    Speech.speak(text, { voice: chosenVoice, rate: 0.96, pitch: 1.0 });
  } catch {}
}

async function geocode(q: string): Promise<Place | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const p = data[0];
  return { label: p.display_name, lat: parseFloat(p.lat), lon: parseFloat(p.lon) };
}

async function getRoutes(from: Place, to: Place): Promise<Route[]> {
  const url =
    'https://router.project-osrm.org/route/v1/driving/' +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    '?overview=full&alternatives=true&geometries=geojson&steps=true';
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) return [];
  const sorted = [...data.routes].sort((a, b) => a.duration - b.duration);
  return sorted.slice(0, 3).map((r, i) => ({
    id: String(i),
    name: i === 0 ? 'Fastest route' : `Alternative ${i}`,
    eta: Math.max(1, Math.round(r.duration / 60)),
    km: Math.round((r.distance / 1000) * 10) / 10,
    best: i === 0,
    coords: (r.geometry?.coordinates ?? []).map((c: [number, number]) => ({
      latitude: c[1],
      longitude: c[0],
    })),
    maneuvers: extractManeuvers(r),
  }));
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [query, setQuery] = useState('');
  const [voya, setVoya] = useState('');
  const [destination, setDestination] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [origin, setOrigin] = useState<Place>({ ...ORIGIN });
  const [hasGPS, setHasGPS] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [distToNext, setDistToNext] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const historyRef = useRef<Turn[]>([]);
  const mutedRef = useRef(false);
  const announcedRef = useRef<Set<string>>(new Set());

  const isWeb = Platform.OS === 'web';
  const bestCoords = routes[0]?.coords ?? [];

  // Real location once on launch (falls back to Melbourne CBD).
  useEffect(() => {
    let cancelled = false;
    initVoice();
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        let label = 'your location';
        try {
          const places = await Location.reverseGeocodeAsync({ latitude, longitude });
          const p = places?.[0];
          if (p) {
            label =
              [p.city || p.subregion || p.district || p.name, p.region].filter(Boolean).join(', ') ||
              label;
          }
        } catch {}
        if (cancelled) return;
        setOrigin({ lat: latitude, lon: longitude, label });
        setHasGPS(true);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Turn-by-turn tracking + spoken guidance while navigating.
  useEffect(() => {
    if (!navigating) return;
    const mans = routes[0]?.maneuvers ?? [];
    if (mans.length === 0) return;
    let idx = 0;
    let sub: Location.LocationSubscription | undefined;
    (async () => {
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 1500 },
          (pos) => {
            const { latitude, longitude } = pos.coords;
            while (
              idx < mans.length - 1 &&
              haversine(latitude, longitude, mans[idx].lat, mans[idx].lon) < 30
            ) {
              idx++;
              setStepIndex(idx);
            }
            const cur = mans[idx];
            const d = haversine(latitude, longitude, cur.lat, cur.lon);
            setDistToNext(d);
            if (d < 320 && !announcedRef.current.has('pre' + idx)) {
              announcedRef.current.add('pre' + idx);
              if (!mutedRef.current) speak(`In ${formatDistSpoken(d)}, ${cur.instruction}`);
            }
          },
        );
      } catch {}
    })();
    return () => {
      try {
        sub?.remove();
      } catch {}
    };
  }, [navigating, routes]);

  function say(msg: string) {
    setVoya(msg);
    if (!mutedRef.current) speak(msg);
  }

  async function go(text: string) {
    const q = text.trim();
    if (!q || phase === 'searching') return;
    setQuery('');
    setPhase('searching');
    setVoya('Thinking…');

    const locContext = hasGPS
      ? `The driver is currently near ${origin.label} (lat ${origin.lat.toFixed(4)}, lon ${origin.lon.toFixed(4)}). Routes start from there.`
      : `The driver's exact location isn't available yet (GPS off or permission not granted), so routes start from Melbourne CBD. You do NOT know their current suburb — say so honestly if asked.`;

    let interp;
    try {
      interp = await interpret(q, historyRef.current, locContext);
    } catch {
      setPhase('error');
      say(`My AI brain had trouble there — give it another go.`);
      return;
    }
    historyRef.current = [
      ...historyRef.current,
      { role: 'user', content: q },
      { role: 'assistant', content: interp.reply || '(ok)' },
    ].slice(-8);

    if (interp.intent === 'cancel') {
      setRoutes([]);
      setDestination(null);
      setPhase('idle');
      say(interp.reply || 'Okay, cancelled.');
      return;
    }

    if (interp.intent === 'chat' || !interp.destination) {
      setPhase('idle');
      say(interp.reply || `I'm here — where do you want to go?`);
      return;
    }

    setVoya(interp.reply || `Let's go.`);
    setRoutes([]);
    setDestination(null);
    try {
      const place = await geocode(interp.destination);
      if (!place) {
        setPhase('error');
        say(`I couldn't find ${interp.destination}. Try the street name with the suburb.`);
        return;
      }
      setDestination(place);
      const rts = await getRoutes(origin, place);
      if (rts.length === 0) {
        setPhase('error');
        say(`I found ${shortLabel(place.label)}, but couldn't work out a driving route just now.`);
        return;
      }
      setRoutes(rts);
      setPhase('results');
      const best = rts[0];
      say(
        `${interp.reply ? interp.reply + ' ' : ''}The fastest route is ${best.eta} minutes, ${best.km} kilometres` +
          `${rts.length > 1 ? `, with ${rts.length} routes to choose from` : ''}.`,
      );
    } catch {
      setPhase('error');
      say(`Something went wrong reaching the maps service. Check your connection and try again.`);
    }
  }

  function startDrive() {
    if (!destination) return;
    announcedRef.current = new Set();
    setStepIndex(0);
    setDistToNext(0);
    setNavigating(true);
    const mans = routes[0]?.maneuvers ?? [];
    if (!mutedRef.current) speak(mans[0]?.instruction ?? 'Navigation started. Follow the route.');
  }

  function endDrive() {
    setNavigating(false);
    setListening(false);
    try {
      Speech.stop();
    } catch {}
    setVoya('Navigation ended.');
    if (!mutedRef.current) speak('Navigation ended.');
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    if (next) {
      try {
        Speech.stop();
      } catch {}
    }
  }

  async function shareTrip() {
    if (!destination) return;
    const best = routes[0];
    try {
      await Share.share({
        message: `I'm heading to ${shortLabel(destination.label)} with VOYA — about ${best?.eta ?? '?'} min${best?.km ? `, ${best.km} km` : ''}.`,
      });
    } catch {}
  }

  function onVoiceCommand() {
    if (listening) {
      setListening(false);
      return;
    }
    setListening(true);
    // Real microphone speech recognition needs a development build. Show the
    // listening UI, then explain.
    setTimeout(() => {
      setListening(false);
      try {
        Speech.stop();
        Speech.speak('Hands-free voice arrives with the next app upgrade.');
      } catch {}
    }, 2200);
  }

  function onMic() {
    if (isWeb) {
      startWebVoice();
      return;
    }
    say(`Voice input arrives with the next app upgrade. For now, type where you want to go and I'll find the route.`);
    inputRef.current?.focus();
  }

  function startWebVoice() {
    const SR: any =
      (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SR) {
      say(`Voice needs a supported browser here. Type your destination instead.`);
      inputRef.current?.focus();
      return;
    }
    const rec = new SR();
    rec.lang = 'en-AU';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setPhase('listening');
    setVoya('Listening…');
    rec.onresult = (ev: any) => {
      const t = ev.results[0][0].transcript;
      setQuery(t);
      go(t);
    };
    rec.onerror = () => {
      setPhase('idle');
      say(`I didn't catch that. Try again, or type it.`);
    };
    rec.onend = () => setPhase((p) => (p === 'listening' ? 'idle' : p));
    rec.start();
  }

  // ---- Full-screen turn-by-turn navigation view ----
  if (navigating && destination) {
    const best = routes[0];
    const mans = best?.maneuvers ?? [];
    const nextMan = mans[Math.min(stepIndex, mans.length - 1)];
    const arr = new Date(Date.now() + (best?.eta ?? 0) * 60000);
    let hh = arr.getHours();
    const mm = arr.getMinutes();
    const ampm = hh >= 12 ? 'pm' : 'am';
    hh = hh % 12 || 12;
    const arrBig = `${hh}:${String(mm).padStart(2, '0')}`;

    return (
      <View style={styles.navRoot}>
        <StatusBar style="light" />
        <MapPane
          origin={origin}
          destination={destination}
          routeCoords={bestCoords}
          following
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.navTopCard}>
          <View style={styles.navTopRow}>
            <View style={styles.navBadge}>
              <Ionicons name="navigate" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.navHeadingLabel}>Heading to</Text>
              <Text style={styles.navHeadingDest} numberOfLines={1}>
                {shortLabel(destination.label)}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={22} color={C.muted} />
          </View>
          <View style={styles.navTopDivider} />
          <Text style={styles.navNextLine} numberOfLines={1}>
            <Text style={styles.navNextLabel}>Next: </Text>
            {nextMan?.instruction ?? 'Continue on route'}
          </Text>
        </View>

        {listening && (
          <View style={styles.listeningRow}>
            <Waveform />
            <View style={styles.listeningPill}>
              <Ionicons name="mic" size={16} color={C.accent} />
              <Text style={styles.listeningText}>Listening…</Text>
            </View>
            <Waveform reverse />
          </View>
        )}

        <View style={styles.navPanel}>
          <View style={styles.grabber} />

          <View style={styles.statsRow}>
            <NavStat icon="time-outline" big={String(best?.eta ?? '—')} unit="min" sub="ETA" />
            <View style={styles.statDivider} />
            <NavStat icon="time-outline" big={arrBig} unit={ampm} sub="Arrival" />
            <View style={styles.statDivider} />
            <NavStat icon="location-outline" big={String(best?.km ?? '—')} unit="km" sub="Distance" />
          </View>

          <View style={styles.maneuverCard}>
            <View style={styles.maneuverIcon}>
              <Ionicons name={turnIcon(nextMan?.modifier ?? '', nextMan?.type ?? '')} size={24} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.maneuverLabel}>Next maneuver</Text>
              <Text style={styles.maneuverInstr} numberOfLines={1}>
                {nextMan?.instruction ?? 'Continue on route'}
              </Text>
            </View>
            <Text style={styles.maneuverDist}>{formatDistShort(distToNext)}</Text>
          </View>

          <View style={styles.actionsRow}>
            <NavAction icon="mic" label="Voice Command" variant="primary" active={listening} onPress={onVoiceCommand} />
            <NavAction
              icon={muted ? 'volume-mute' : 'volume-high'}
              label="Mute"
              variant="plain"
              active={muted}
              onPress={toggleMute}
            />
            <NavAction icon="share-outline" label="Share Trip" variant="plain" onPress={shareTrip} />
            <NavAction icon="close" label="End Trip" variant="danger" onPress={endDrive} />
          </View>
        </View>
      </View>
    );
  }

  const listeningHome = phase === 'listening';
  const searching = phase === 'searching';
  const results = phase === 'results';

  const status = listeningHome
    ? 'Listening…'
    : searching
      ? 'Working on it…'
      : isWeb
        ? 'Tap the mic and say where you want to go'
        : 'Type a destination — or tap the mic';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.wordmark}>VOYA</Text>
        <Text style={styles.tagline}>{hasGPS ? `Near ${origin.label}` : 'Say it. Drive it.'}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {voya ? (
          <View style={[styles.aiCard, phase === 'error' && styles.aiCardError]}>
            <View style={styles.aiHeader}>
              <Ionicons name="sparkles" size={14} color={C.accent} />
              <Text style={styles.aiLabel}>VOYA AI</Text>
              {searching && <ActivityIndicator size="small" color={C.accent} style={{ marginLeft: 4 }} />}
            </View>
            <Text style={styles.aiText}>{voya}</Text>
          </View>
        ) : (
          <View style={styles.quoteCard}>
            <Text style={styles.quoteLabel}>TRY SAYING</Text>
            <Text style={styles.quoteText}>“Take me to 3 Langshan Rd, Clyde North”</Text>
            {!aiEnabled && (
              <Text style={styles.aiHint}>Add your Anthropic key to .env.local to switch on VOYA AI.</Text>
            )}
          </View>
        )}

        {results && destination && (
          <>
            <MapPane origin={origin} destination={destination} routeCoords={bestCoords} style={styles.map} />

            <View style={styles.destCard}>
              <Ionicons name="location-sharp" size={20} color={C.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.destLabel}>DESTINATION</Text>
                <Text style={styles.destText}>{destination.label}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>
              {routes.length} {routes.length === 1 ? 'route' : 'routes'} · from {origin.label}
            </Text>
            {routes.map((r) => (
              <RouteCard key={r.id} route={r} />
            ))}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Type a destination…"
            placeholderTextColor={C.muted}
            returnKeyType="go"
            onSubmitEditing={() => go(query)}
            editable={!searching}
          />
          <Pressable
            style={[styles.sendBtn, !query.trim() && styles.sendBtnOff]}
            onPress={() => go(query)}
            disabled={!query.trim() || searching}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </Pressable>
        </View>

        <Text style={styles.status}>{status}</Text>

        <Pressable
          onPress={onMic}
          style={[
            styles.mic,
            listeningHome && { backgroundColor: C.red },
            searching && { backgroundColor: C.surfaceAlt },
          ]}
        >
          <Ionicons name={searching ? 'ellipsis-horizontal' : 'mic'} size={30} color="#fff" />
        </Pressable>

        {results && (
          <Pressable style={styles.startBtn} onPress={startDrive}>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={styles.startText}>Start drive</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Waveform({ reverse }: { reverse?: boolean }) {
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.35))).current;
  useEffect(() => {
    const anims = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 340 + i * 70, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.35, duration: 340 + i * 70, useNativeDriver: true }),
        ]),
      ),
    );
    const timers = anims.map((a, i) => setTimeout(() => a.start(), i * 90));
    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.stop());
    };
  }, []);
  const order = reverse ? [...bars].reverse() : bars;
  return (
    <View style={styles.waveRow}>
      {order.map((b, i) => (
        <Animated.View key={i} style={[styles.waveBar, { transform: [{ scaleY: b }] }]} />
      ))}
    </View>
  );
}

function NavStat({ icon, big, unit, sub }: { icon: any; big: string; unit?: string; sub: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statTop}>
        <Ionicons name={icon} size={15} color={C.accent} />
        <Text style={styles.statBig}>{big}</Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function NavAction({
  icon,
  label,
  variant,
  active,
  onPress,
}: {
  icon: any;
  label: string;
  variant: 'primary' | 'plain' | 'danger';
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View
        style={[
          styles.actionIcon,
          variant === 'primary' && styles.actionPrimary,
          variant === 'danger' && styles.actionDanger,
          active && variant === 'plain' && styles.actionActive,
        ]}
      >
        <Ionicons name={icon} size={22} color={variant === 'plain' && !active ? C.text : '#fff'} />
      </View>
      <Text style={[styles.actionLabel, variant === 'danger' && { color: C.red }]}>{label}</Text>
    </Pressable>
  );
}

function RouteCard({ route }: { route: Route }) {
  return (
    <View style={[styles.routeCard, route.best && styles.routeCardRec]}>
      <View style={styles.routeTop}>
        <Text style={styles.routeName}>{route.name}</Text>
        {route.best && (
          <View style={styles.recBadge}>
            <Ionicons name="checkmark" size={12} color="#fff" />
            <Text style={styles.recBadgeText}>BEST</Text>
          </View>
        )}
      </View>
      <View style={styles.metricsRow}>
        <Metric icon="time-outline" value={`${route.eta} min`} />
        <Metric icon="git-network-outline" value={`${route.km} km`} />
      </View>
    </View>
  );
}

function Metric({ icon, value }: { icon: any; value: string }) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={15} color={C.muted} />
      <Text style={styles.metricText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { paddingTop: 58, paddingHorizontal: 22, paddingBottom: 8 },
  wordmark: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: 2 },
  tagline: { color: C.muted, fontSize: 13, marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 },

  quoteCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginTop: 28,
  },
  quoteLabel: { color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  quoteText: { color: C.text, fontSize: 19, fontWeight: '600', lineHeight: 27 },
  aiHint: { color: C.amber, fontSize: 12, marginTop: 14, lineHeight: 17 },

  aiCard: {
    backgroundColor: C.accentSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.accent,
    padding: 16,
    marginBottom: 18,
    marginTop: 4,
  },
  aiCardError: { backgroundColor: '#2A1A1A', borderColor: C.red },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  aiLabel: { color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  aiText: { color: C.text, fontSize: 16, lineHeight: 23 },

  map: { height: 220, borderRadius: 14, overflow: 'hidden', marginBottom: 14 },

  destCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 14,
  },
  destLabel: { color: C.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  destText: { color: C.text, fontSize: 15, fontWeight: '600', marginTop: 2 },

  sectionTitle: { color: C.muted, fontSize: 13, fontWeight: '700', marginBottom: 10, letterSpacing: 0.3 },

  routeCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
  },
  routeCardRec: { borderColor: C.accent, backgroundColor: '#1B1E33' },
  routeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  routeName: { color: C.text, fontSize: 16, fontWeight: '700', flex: 1 },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  recBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  metricsRow: { flexDirection: 'row', gap: 18 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricText: { color: C.text, fontSize: 14, fontWeight: '600' },

  footer: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
    alignItems: 'center',
    gap: 12,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 16,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: C.surfaceAlt },
  status: { color: C.muted, fontSize: 13 },
  mic: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.accent,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 15,
    width: '100%',
  },
  startText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ---- Navigation view ----
  navRoot: { flex: 1, backgroundColor: C.bg },
  navTopCard: {
    position: 'absolute',
    top: 52,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(20,23,28,0.92)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(109,99,255,0.45)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.accent,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  navHeadingLabel: { color: C.muted, fontSize: 14 },
  navHeadingDest: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 1 },
  navTopDivider: { height: 1, backgroundColor: C.border, marginVertical: 11 },
  navNextLine: { color: C.text, fontSize: 14 },
  navNextLabel: { color: C.accent, fontWeight: '700' },

  listeningRow: {
    position: 'absolute',
    top: 176,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  listeningPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(20,23,28,0.96)',
    borderWidth: 1,
    borderColor: C.accent,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  listeningText: { color: C.text, fontSize: 15, fontWeight: '600' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 26 },
  waveBar: { width: 3, height: 22, borderRadius: 2, backgroundColor: C.accent },

  navPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(18,21,26,0.98)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 16,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.border, marginBottom: 4 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  statBig: { color: C.text, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  statUnit: { color: C.muted, fontSize: 13, marginBottom: 3 },
  statSub: { color: C.muted, fontSize: 12, marginTop: 4 },
  statDivider: { width: 1, height: 42, backgroundColor: C.border },

  maneuverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  maneuverIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(34,197,94,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  maneuverLabel: { color: C.muted, fontSize: 12 },
  maneuverInstr: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 2 },
  maneuverDist: { color: C.accent, fontSize: 16, fontWeight: '700' },

  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  action: { alignItems: 'center', gap: 7, flex: 1 },
  actionIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  actionPrimary: {
    backgroundColor: C.accent,
    borderColor: C.accent,
    shadowColor: C.accent,
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  actionDanger: { backgroundColor: C.red, borderColor: C.red },
  actionActive: { backgroundColor: C.accent, borderColor: C.accent },
  actionLabel: { color: C.muted, fontSize: 12 },
});

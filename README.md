# VOYA 🚗🎙️

**Voice-first navigation for delivery drivers — say where you want to go, and an AI co-pilot does the rest.**

![Expo](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Claude](https://img.shields.io/badge/AI-Claude%20Opus-D97757)
![Platform](https://img.shields.io/badge/iOS%20%7C%20Android-Expo%20Go-555)

---

## The problem

I do Uber Eats delivery. Every drop means typing an address into a maps app — and typing while driving (even with the phone on a stand) is unsafe and breaks your focus on the road.

**VOYA fixes that.** You speak (or type) where you want to go, and a conversational AI agent — *VOYA AI* — understands you, finds the best route, and guides you there with in-app turn-by-turn navigation and spoken directions. Hands stay on the wheel, eyes stay on the road.

## What it does

- 🎙️ **Conversational AI agent (VOYA AI)** — understands natural, messy requests ("I've got a drop near the Clyde North shops"), pulls out the destination, replies like a co-pilot, and speaks back.
- 🗺️ **In-app map & navigation** — a dark, branded map with your live location, the route line, and a 3D follow camera. No bouncing out to another app.
- 🧭 **Turn-by-turn with voice guidance** — spoken directions ("in 250 metres, turn right onto Frizzella Drive"), a live next-maneuver card, and ETA / arrival time / distance.
- 🛣️ **Real routing** — geocodes any Australian address and returns multiple driving routes with real distance and drive time.
- 🔊 **Driver-friendly controls** — mute, share trip, and a one-tap end.
- 📍 **Real GPS** — routes start from where you actually are.

## How it works

```
You speak/type
      │
      ▼
VOYA AI (Claude)  ──►  intent + clean destination + a spoken reply
      │
      ▼
Geocoding (OpenStreetMap / Nominatim)  ──►  coordinates
      │
      ▼
Routing (OSRM)  ──►  routes, ETAs, turn-by-turn steps
      │
      ▼
In-app map + spoken turn-by-turn navigation
```

The AI layer is grounded with the driver's real location and constrained to be honest — it won't invent traffic, tolls, or a location it doesn't have.

## Tech stack

- **React Native + Expo (SDK 54)**, **TypeScript**
- **Anthropic Claude** (`claude-opus-4-8`) — the VOYA AI conversational brain
- **react-native-maps** — in-app maps (Apple Maps on iOS)
- **expo-location** (GPS) · **expo-speech** (voice output)
- **OpenStreetMap Nominatim** (geocoding) · **OSRM** (routing & turn-by-turn)

## Getting started

> Requires [Node.js](https://nodejs.org) and the **Expo Go** app on your phone.

```bash
# 1. Clone
git clone https://github.com/akeeshh/voya.git
cd voya

# 2. Install dependencies
npm install

# 3. (Optional) enable the AI brain — add your Anthropic API key
cp .env.example .env.local
#   then edit .env.local and set EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...

# 4. Run it
npm start
```

Scan the QR code with **Expo Go** (iOS/Android), or press `w` for the web preview.

> Without an API key, VOYA still runs using a simple built-in parser — the AI replies just aren't conversational until a key is added. Your key lives in `.env.local`, which is gitignored and never committed.

<!-- Add screenshots: drop images into a /screenshots folder and uncomment:
## Screenshots
| Home | Routes | Navigation |
|------|--------|------------|
| ![](screenshots/home.png) | ![](screenshots/routes.png) | ![](screenshots/nav.png) |
-->

## Roadmap

- [x] Conversational AI destination understanding
- [x] Real geocoding + multi-route results
- [x] In-app map with live location & 3D follow
- [x] Turn-by-turn with spoken guidance
- [ ] Hands-free **voice input** (speech-to-text) — via a development build
- [ ] **Human-quality neural voice** (e.g. ElevenLabs)
- [ ] Live **tolls, traffic & traffic-light-aware** routing
- [ ] **Self-learning** per-driver route preferences
- [ ] Automatic re-routing when off-route

## Status

🚧 In active development (started June 2026). The voice-driven flow, AI agent, in-app map, and spoken turn-by-turn navigation are working; the items above are next.

## Author

**Ahkeeshan Sarvananthan**
- GitHub: [@akeeshh](https://github.com/akeeshh)
- LinkedIn: [linkedin.com/in/akeeshh](https://linkedin.com/in/akeeshh)

## License

[MIT](LICENSE)

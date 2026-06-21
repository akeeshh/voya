# VOYA 🚗🎙️

Voice-first navigation for delivery drivers. You say where you want to go, and an AI co-pilot finds the route and guides you there, hands free.

![Expo](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Claude](https://img.shields.io/badge/AI-Claude%20Opus-D97757)
![Platform](https://img.shields.io/badge/iOS%20%7C%20Android-Expo%20Go-555)

## Why I built it

I do Uber Eats delivery. Every drop means typing an address into a maps app, and typing while driving is unsafe even with the phone on a stand. It pulls your attention off the road right when you need it.

VOYA is my fix for that. You speak or type where you want to go, an AI agent called VOYA AI works out the destination, finds the best route, and guides you with in-app turn-by-turn navigation and spoken directions. Your hands stay on the wheel and your eyes stay on the road.

## What it does

- A conversational AI agent (VOYA AI) that understands plain, messy requests like "I've got a drop near the Clyde North shops", pulls out the destination, and talks back.
- An in-app map with your live location, the route line, and a 3D camera that follows you. No jumping out to another app.
- Turn-by-turn with spoken directions, a live next-turn card, and ETA, arrival time and distance.
- Real routing for any Australian address, with a few route options to choose from.
- Driver-friendly controls: mute, share trip, and a one-tap end.

## How it works

```
You speak or type
        |
        v
VOYA AI (Claude)            works out the intent and a clean destination
        |
        v
Geocoding (Nominatim)       turns the place into coordinates
        |
        v
Routing (OSRM)              returns routes, ETAs and turn-by-turn steps
        |
        v
In-app map with spoken turn-by-turn navigation
```

The AI gets your real location as context and is kept honest, so it won't make up traffic, tolls or a location it doesn't actually have.

## Tech stack

- React Native and Expo (SDK 54), TypeScript
- Anthropic Claude (claude-opus-4-8) for the VOYA AI agent
- react-native-maps for the in-app map (Apple Maps on iOS)
- expo-location for GPS, expo-speech for voice output
- OpenStreetMap Nominatim for geocoding, OSRM for routing and turn steps

## Getting started

> You'll need [Node.js](https://nodejs.org) and the Expo Go app on your phone.

```bash
# 1. Clone
git clone https://github.com/akeeshh/voya.git
cd voya

# 2. Install dependencies
npm install

# 3. (Optional) turn on the AI brain by adding your Anthropic API key
cp .env.example .env.local
#    then edit .env.local and set EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...

# 4. Run it
npm start
```

Scan the QR code with Expo Go on iOS or Android, or press `w` for the web preview.

Without an API key, VOYA still runs using a simple built-in parser. The replies just aren't conversational until you add a key. Your key lives in `.env.local`, which is gitignored and never committed.

<!-- Add screenshots: drop images into a /screenshots folder and uncomment:
## Screenshots
| Home | Routes | Navigation |
|------|--------|------------|
| ![](screenshots/home.png) | ![](screenshots/routes.png) | ![](screenshots/nav.png) |
-->

## Roadmap

- [x] Conversational AI destination understanding
- [x] Real geocoding and multiple route options
- [x] In-app map with live location and 3D follow
- [x] Turn-by-turn with spoken guidance
- [ ] Hands-free voice input (speech-to-text)
- [ ] More natural, human-sounding voice
- [ ] Live tolls, traffic and traffic-light aware routing
- [ ] Route preferences that learn from how you drive
- [ ] Automatic re-routing when you go off route

## Status

In active development, started June 2026. The voice flow, the AI agent, the in-app map and spoken turn-by-turn navigation are all working. The roadmap items are what's next.

## Author

Ahkeeshan Sarvananthan
GitHub: [@akeeshh](https://github.com/akeeshh)
LinkedIn: [linkedin.com/in/akeeshh](https://linkedin.com/in/akeeshh)

## License

[MIT](LICENSE)

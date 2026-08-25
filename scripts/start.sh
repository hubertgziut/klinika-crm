#!/bin/bash
# Uruchomienie serwera Klinika CRM (lokalnie, LAN)
set -e
cd "$(dirname "$0")/.."
if [ ! -d node_modules ]; then npm install; fi
if [ ! -f .env ]; then cp .env.example .env && echo "Utworzono .env — uzupełnij dane!"; fi
npm run start

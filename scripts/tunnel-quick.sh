#!/bin/bash
# Szybki tunel Cloudflare — publiczny adres (zmienia się przy każdym starcie)
# Wymaga: cloudflared (brew install cloudflared)
set -e
echo "Uruchamiam tunel Cloudflare do http://localhost:3030 ..."
echo "Publiczny adres pojawi się w logach (https://....trycloudflare.com)"
cloudflared tunnel --url http://localhost:3030 --no-autoupdate

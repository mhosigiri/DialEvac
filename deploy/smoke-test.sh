#!/usr/bin/env bash
# Runs the built images together with fake credentials. It places no calls and cannot write to a
# database, because the fake service token holds no grant and the route worker targets a closed port.
#   docker compose --file deploy/compose.yml build && deploy/smoke-test.sh
set -u
NET=dialevac-smoke
PORT_WEB=${PORT_WEB:-18080}
KEEP=${KEEP:-0}
failures=0

check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: expected '$3', got '$2'"; failures=$((failures + 1)); fi
}
contains() {
  case "$2" in *"$3"*) echo "PASS $1" ;; *) echo "FAIL $1: '$3' not in '${2:0:200}'"; failures=$((failures + 1)) ;; esac
}
cleanup() {
  docker rm -f smoke-web smoke-inbox smoke-routes smoke-router >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
}
wait_for() {
  for _ in $(seq 1 40); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  return 1
}

cleanup
docker network create "$NET" >/dev/null
FAKE=(-e SPACETIME_DEMO_SERVICE_TOKEN=fake-token -e ELEVENLABS_API_KEY=fake -e ELEVENLABS_AGENT_ID=fake -e ELEVENLABS_WEBHOOK_SECRET=fake)

docker run -d --name smoke-router --network "$NET" dialevac-demo-router >/dev/null
docker run -d --name smoke-inbox --network "$NET" --init -e PORT=9090 -e ANTHROPIC_API_KEY=fake "${FAKE[@]}" dialevac-demo-inbox npm run -s voice >/dev/null
docker run -d --name smoke-routes --network "$NET" --init "${FAKE[@]}" -e SPACETIME_ROUTE_URI=ws://127.0.0.1:1 -e SPACETIME_ROUTE_DATABASE=smoke \
  -e OSMNX_ROUTER_URL=http://smoke-router:8800 dialevac-demo-routes npm run -s routes >/dev/null
docker run -d --name smoke-web --network "$NET" -p "$PORT_WEB:8080" -e INBOX_UPSTREAM=smoke-inbox:9090 dialevac-demo-web >/dev/null

BASE=http://127.0.0.1:$PORT_WEB
wait_for "$BASE/healthz" && echo "PASS web starts" || { echo "FAIL web did not start"; failures=$((failures + 1)); }

code() { curl -s -o /dev/null -w '%{http_code}' "$BASE$1"; }
header() { curl -sI "$BASE$1" | tr -d '\r' | awk -v k="$(echo "$2" | tr 'A-Z' 'a-z'):" 'tolower($1)==k { $1=""; sub(/^ /,""); print; exit }'; }

check "portal at /" "$(code /)" 200
check "driver at /driver/" "$(code /driver/)" 200
check "map at /map/index.html" "$(code /map/index.html)" 200
check "contour library is served locally" "$(code /map/assets/vendor/maplibre-contour.min.js)" 200
check "map bindings bundle exists" "$(code /map/assets/spacetime.js)" 200
check "map server upload route is absent" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/save?name=x" -d x)" 404
contains "map may only be embedded by this site" "$(header /map/index.html Content-Security-Policy)" "frame-ancestors 'self'"
check "index.html revalidates" "$(header / Cache-Control)" "no-cache"
PORTAL_JS=$(curl -s "$BASE/" | grep -oE '/assets/index-[^"]+\.js')
check "hashed assets are immutable" "$(header "$PORTAL_JS" Cache-Control)" "public, max-age=31536000, immutable"

DRIVER_JS=$(curl -s "$BASE/driver/" | grep -oE 'assets/index-[^"]+\.js')
check "driver asset loads from a subpath" "$(code "/driver/$DRIVER_JS")" 200
for bundle in "$PORTAL_JS" "/driver/$DRIVER_JS"; do
  body=$(curl -s "$BASE$bundle")
  contains "$bundle targets the demo database" "$body" "hackutd-richardson"
  contains "$bundle embeds the map from this site" "$body" "/map/index.html"
  case "$body" in *"127.0.0.1:4178"*) echo "FAIL $bundle still points at localhost"; failures=$((failures + 1)) ;; *) echo "PASS $bundle has no localhost map" ;; esac
done
case "$(curl -s "$BASE/map/index.html")" in *unpkg.com*) echo "FAIL map still loads from unpkg"; failures=$((failures + 1)) ;; *) echo "PASS map does not load from unpkg" ;; esac

for _ in $(seq 1 15); do [ "$(code /capabilities)" = 200 ] && break; sleep 1; done
contains "inbox honors PORT and is reachable through web" "$(curl -s "$BASE/capabilities")" '"database":"hackutd-richardson"'
contains "/ready reports the rejected database connection" "$(curl -s "$BASE/ready")" '"database":false'
check "/ready returns 503 while unhealthy" "$(code /ready)" 503
check "unsigned webhook is rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/elevenlabs/webhook" -d '{}')" 401
sleep 8
contains "route worker keeps retrying" "$(docker logs smoke-routes 2>&1)" "reconnecting after subscription failure"
check "route worker stays up" "$(docker inspect -f '{{.State.Running}}' smoke-routes)" true

check "inbox runs as non-root" "$(docker exec smoke-inbox id -un)" node
check "router runs as non-root" "$(docker exec smoke-router id -un)" router
check "inbox can write its spool" "$(docker exec smoke-inbox sh -c 'test -w /app/services/.spacetime/call-inbox && echo yes')" yes
check "router can write its cache" "$(docker exec smoke-router sh -c 'test -w /data/osmnx && echo yes')" yes
for image in dialevac-demo-web dialevac-demo-inbox dialevac-demo-router; do
  found=$(docker run --rm --entrypoint sh "$image" -c 'find / -xdev \( -name ".env" -o -name ".env.*" -o -name "demo-auth.json" \) -not -path "*/node_modules/*" -not -path "/proc/*" -not -path "/sys/*" 2>/dev/null | wc -l | tr -d " "')
  check "$image holds no secret files" "$found" 0
done

SEED=$(cd "$(dirname "$0")/.." && pwd)/dispatch/.cache/osmnx
if [ -d "$SEED" ]; then
  docker cp "$SEED/." smoke-router:/data/osmnx/ >/dev/null 2>&1
  route=$(docker exec smoke-router .venv/bin/python -c "import json,urllib.request as u; r=json.load(u.urlopen('http://127.0.0.1:8800/route/v1/driving/-95.405,29.77;-95.39271099,29.76123664?overview=full&geometries=geojson&steps=true',timeout=120)); print(r['code'],r['source'],round(r['routes'][0]['distance']))" 2>&1 | tail -1)
  check "router serves a real route from the seeded cache" "$route" "Ok osmnx 2146"
else
  echo "SKIP real route: no local road cache at dispatch/.cache/osmnx"
fi

start=$SECONDS; docker stop smoke-inbox >/dev/null; stopped=$((SECONDS - start))
[ "$stopped" -lt 8 ] && echo "PASS inbox stops on SIGTERM in ${stopped}s" || { echo "FAIL inbox took ${stopped}s to stop"; failures=$((failures + 1)); }

echo; [ "$KEEP" = 1 ] || cleanup
echo "failures=$failures"
[ "$failures" = 0 ]

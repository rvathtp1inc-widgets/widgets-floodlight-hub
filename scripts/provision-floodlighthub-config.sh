#!/usr/bin/env bash

set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "Usage: $0 <serial-number> <device-secret> [api-base-url] [heartbeat-seconds]" >&2
  exit 1
fi

serial_number="$1"
device_secret="$2"
api_base_url="${3:-https://api.widgetsinc.io}"
heartbeat_seconds="${4:-60}"
target_path="${FLOODLIGHT_HUB_CONFIG_PATH:-/usr/local/widgets-data/floodlighthub.json}"
target_dir="$(dirname "$target_path")"

mkdir -p "$target_dir"

cat > "$target_path" <<JSON
{
  "device": {
    "serialNumber": "$serial_number",
    "deviceSecret": "$device_secret",
    "model": "widgets-floodlight-hub"
  },
  "cloud": {
    "enabled": true,
    "apiBaseUrl": "$api_base_url",
    "heartbeatIntervalSeconds": $heartbeat_seconds
  }
}
JSON

chmod 600 "$target_path"
echo "Wrote provisioning config to $target_path"
